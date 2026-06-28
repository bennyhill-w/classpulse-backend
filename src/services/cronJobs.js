const cron = require("node-cron");
const prisma = require("../prisma");

function formatTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function isSchoolHours() {
  const now = new Date();
  const hour = now.getHours();
  // School hours: 7AM to 5PM Monday to Friday
  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
  const isDuringSchool = hour >= 7 && hour < 17;
  return isWeekday && isDuringSchool;
}

// ── JOB 1: IDLE CLASS DETECTION ──────────────────────────────────
// Runs every 5 minutes during school hours
// Checks for classes that should have started but haven't
async function detectIdleClasses(io, forceRun = false) {
  if (!forceRun && !isSchoolHours()) return;

  try {
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const threshold = parseInt(process.env.IDLE_THRESHOLD_MINS || "15");

    // Get all timetable entries scheduled for today
    const dayOfWeek = now.getDay();
    const timetable = await prisma.timetable.findMany({
      where: { dayOfWeek },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            title: true,
            staffId: true,
          },
        },
      },
    });

    for (const entry of timetable) {
      // Parse scheduled start time
      const [h, m] = entry.startTime.split(":").map(Number);
      const scheduledStart = new Date();
      scheduledStart.setHours(h, m, 0, 0);

      // How many minutes since the class was supposed to start?
      const minsOverdue = Math.floor((now - scheduledStart) / 60000);

      // Only flag if overdue by threshold and hasn't started yet
      if (minsOverdue < threshold) continue;

      // Check if teacher already started a class session for this subject today
      const existingSession = await prisma.classSession.findFirst({
        where: {
          userId: entry.userId,
          subject: entry.subject,
          date: { gte: today },
        },
      });

      if (existingSession) continue; // class was started — no alert needed

      // Check if we already created an alert for this in the last hour
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const existingAlert = await prisma.alert.findFirst({
        where: {
          teacherId: entry.userId,
          title: { contains: entry.subject },
          resolved: false,
          createdAt: { gte: oneHourAgo },
        },
      });

      if (existingAlert) continue; // alert already exists

      const teacherName =
        `${entry.user.title || ""} ${entry.user.firstName} ${entry.user.lastName}`.trim();

      // Create alert
      const alert = await prisma.alert.create({
        data: {
          type: "danger",
          title: `${teacherName} — ${entry.subject} class unattended`,
          description: `Scheduled ${entry.startTime}–${entry.endTime}. No class started after ${minsOverdue} minutes. ${entry.classYear} ${entry.trade} · ${entry.room}`,
          teacherId: entry.userId,
        },
      });

      // Create event
      await prisma.event.create({
        data: {
          userId: entry.userId,
          type: "idle",
          detail: `Idle class detected — ${entry.subject} was due at ${entry.startTime}, ${minsOverdue} mins overdue`,
          badge: "IDLE CLASS",
          badgeClass: "fb-red",
        },
      });

      // Emit real-time alert to admin
      if (io) {
        io.to("admin_room").emit("alert:idle", {
          alertId: alert.id,
          teacherName,
          subject: entry.subject,
          trade: entry.trade,
          classYear: entry.classYear,
          room: entry.room,
          scheduledTime: entry.startTime,
          minsOverdue,
          description: alert.description,
        });

        // Update stats
        const idleCount = await prisma.alert.count({
          where: { resolved: false, type: "danger" },
        });
        io.to("admin_room").emit("stats:update", { idleClasses: idleCount });
      }

      console.log(
        `[CRON] Idle class alert: ${teacherName} — ${entry.subject} (${minsOverdue} mins overdue)`,
      );
    }
  } catch (error) {
    console.error("[CRON] Idle class detection error:", error);
  }
}

// ── JOB 2: ABSENT TEACHER FLAGGING ───────────────────────────────
// Runs daily at 9:00 AM
// Finds teachers who haven't checked in and flags them
async function flagAbsentTeachers(io) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all teachers
    const teachers = await prisma.user.findMany({
      where: { role: "teacher" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        title: true,
        staffId: true,
      },
    });

    for (const teacher of teachers) {
      // Check if they've checked in today
      const attendance = await prisma.attendance.findFirst({
        where: { userId: teacher.id, date: { gte: today } },
      });

      if (attendance) continue; // checked in — not absent

      // Check if absent alert already exists today
      const existingAlert = await prisma.alert.findFirst({
        where: {
          teacherId: teacher.id,
          type: "danger",
          createdAt: { gte: today },
          title: { contains: "Absent" },
        },
      });

      if (existingAlert) continue;

      const teacherName =
        `${teacher.title || ""} ${teacher.firstName} ${teacher.lastName}`.trim();

      // Create absent alert
      const alert = await prisma.alert.create({
        data: {
          type: "danger",
          title: `${teacherName} — Absent (No check-in)`,
          description: `No check-in recorded as of 9:00 AM. Staff ID: ${teacher.staffId}. Classes may be unattended.`,
          teacherId: teacher.id,
        },
      });

      // Create event
      await prisma.event.create({
        data: {
          userId: teacher.id,
          type: "absent",
          detail: `Flagged absent — no check-in recorded by 9:00 AM`,
          badge: "ABSENT",
          badgeClass: "fb-red",
        },
      });

      // Emit to admin
      if (io) {
        io.to("admin_room").emit("alert:absent", {
          alertId: alert.id,
          teacherName,
          staffId: teacher.staffId,
          description: alert.description,
        });
      }

      console.log(`[CRON] Absent alert: ${teacherName} (${teacher.staffId})`);
    }
  } catch (error) {
    console.error("[CRON] Absent flagging error:", error);
  }
}

// ── JOB 3: LATE PATTERN DETECTION ────────────────────────────────
// Runs daily at 9:30 AM
// Flags teachers with 3+ late arrivals this week
async function detectLatePatterns(io) {
  try {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    // Find teachers with 3+ late arrivals this week
    const lateTeachers = await prisma.attendance.groupBy({
      by: ["userId"],
      where: { isLate: true, checkInAt: { gte: weekStart } },
      having: { userId: { _count: { gte: 3 } } },
      _count: { userId: true },
    });

    for (const entry of lateTeachers) {
      const teacher = await prisma.user.findUnique({
        where: { id: entry.userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          title: true,
          staffId: true,
        },
      });

      if (!teacher) continue;

      // Check if pattern alert already exists this week
      const existing = await prisma.alert.findFirst({
        where: {
          teacherId: teacher.id,
          type: "warn",
          createdAt: { gte: weekStart },
          title: { contains: "late arrivals" },
        },
      });

      if (existing) continue;

      const teacherName =
        `${teacher.title || ""} ${teacher.firstName} ${teacher.lastName}`.trim();
      const lateCount = entry._count.userId;

      await prisma.alert.create({
        data: {
          type: "warn",
          title: `${teacherName} — ${lateCount} late arrivals this week`,
          description: `Pattern detected. ${lateCount} late check-ins recorded this week. Recommend follow-up. Staff ID: ${teacher.staffId}`,
          teacherId: teacher.id,
        },
      });

      if (io) {
        io.to("admin_room").emit("alert:late_pattern", {
          teacherName,
          staffId: teacher.staffId,
          lateCount,
        });
      }

      console.log(
        `[CRON] Late pattern: ${teacherName} — ${lateCount} late this week`,
      );
    }
  } catch (error) {
    console.error("[CRON] Late pattern detection error:", error);
  }
}

// ── JOB 4: LIVE STATS REFRESH ────────────────────────────────────
// Runs every 60 seconds during school hours
// Pushes updated stats to all connected admin dashboards
async function refreshStats(io) {
  if (!io) return;
  if (!isSchoolHours()) return;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [present, late, activeClasses, idleAlerts, totalStaff] =
      await Promise.all([
        prisma.attendance.count({ where: { date: { gte: today } } }),
        prisma.attendance.count({
          where: { date: { gte: today }, isLate: true },
        }),
        prisma.classSession.count({
          where: { date: { gte: today }, endedAt: null },
        }),
        prisma.alert.count({ where: { resolved: false, type: "danger" } }),
        prisma.user.count({ where: { role: "teacher" } }),
      ]);

    io.to("admin_room").emit("stats:update", {
      present,
      absent: totalStaff - present,
      late,
      activeClasses,
      idleClasses: idleAlerts,
      totalStaff,
    });
  } catch (error) {
    console.error("[CRON] Stats refresh error:", error);
  }
}

// ── INITIALISE ALL CRON JOBS ─────────────────────────────────────
function initCronJobs(io) {
  console.log("[CRON] Initialising background jobs...");

  // Job 1 — Idle class detection every 5 minutes
  cron.schedule("*/5 * * * *", () => {
    console.log("[CRON] Running idle class detection...");
    detectIdleClasses(io, false);
  });

  // Job 2 — Absent teacher flagging at 9:00 AM every weekday
  cron.schedule("0 9 * * 1-5", () => {
    console.log("[CRON] Running absent teacher flagging...");
    flagAbsentTeachers(io);
  });

  // Job 3 — Late pattern detection at 9:30 AM every weekday
  cron.schedule("30 9 * * 1-5", () => {
    console.log("[CRON] Running late pattern detection...");
    detectLatePatterns(io);
  });

  // Job 4 — Live stats refresh every 60 seconds
  cron.schedule("* * * * *", () => {
    refreshStats(io);
  });

  console.log("[CRON] All background jobs scheduled ✅");
  console.log("[CRON] - Idle detection:     every 5 minutes");
  console.log("[CRON] - Absent flagging:    daily at 9:00 AM");
  console.log("[CRON] - Late patterns:      daily at 9:30 AM");
  console.log("[CRON] - Stats refresh:      every 60 seconds");
}

// Export individual jobs for manual testing
module.exports = {
  initCronJobs,
  detectIdleClasses,
  flagAbsentTeachers,
  detectLatePatterns,
  refreshStats,
};
