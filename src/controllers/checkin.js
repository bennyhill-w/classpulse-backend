const prisma = require("../prisma");

// ── HELPERS ──────────────────────────────────────────────────────
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getLateStatus(checkInTime) {
  // Parse school start time from env
  const [startHour, startMinute] = (process.env.SCHOOL_START_TIME || "08:00")
    .split(":")
    .map(Number);
  const threshold = parseInt(process.env.LATE_THRESHOLD_MINS || "15");

  // Build today's official start time
  const schoolStart = new Date(checkInTime);
  schoolStart.setHours(startHour, startMinute, 0, 0);

  // How many minutes after school start is this check-in?
  const diffMs = checkInTime.getTime() - schoolStart.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  // If before school start or within threshold — on time
  // If more than threshold minutes after start — late
  const isLate = diffMins > threshold;
  const lateMinutes = isLate ? diffMins : 0;

  return { isLate, lateMinutes };
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Valid QR tokens — in production these come from the database per classroom
// For now the gate QR token is fixed
const VALID_QR_TOKENS = ["GATE_QR_GTC_AGIDINGBI"];

// ── CHECK IN ─────────────────────────────────────────────────────
async function checkIn(req, res) {
  try {
    const { method, lat, lng, qrToken } = req.body;
    const userId = req.user.id;

    // ── Validate method ───────────────────────────────────────────
    if (!method || !["gps", "qr"].includes(method)) {
      return res.status(400).json({
        success: false,
        message: 'Check-in method must be "gps" or "qr"',
      });
    }

    const existing = await prisma.attendance.findFirst({
      where: {
        userId,
        checkOutAt: null, // only block if they haven't checked out yet
      },
      orderBy: {
        checkInAt: "desc",
      },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "You have already checked in and have not checked out yet.",
        data: { attendance: existing },
      });
    }

    // Block check-in after school closing hour (3 PM)
    const checkInHour = new Date().getUTCHours() + 1; // WAT = UTC+1
    if (checkInHour >= 15) {
      return res.status(400).json({
        success: false,
        message: "Check-in is closed. School hours ended at 3:00 PM.",
      });
    }

    // ── GPS VALIDATION ────────────────────────────────────────────
    if (method === "gps") {
      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          message: "GPS coordinates are required",
        });
      }

      const schoolLat = parseFloat(process.env.SCHOOL_LAT || "6.6018");
      const schoolLng = parseFloat(process.env.SCHOOL_LNG || "3.3515");
      const allowedRadius = parseFloat(process.env.SCHOOL_RADIUS_KM || "0.15");

      const distance = getDistanceKm(
        parseFloat(lat),
        parseFloat(lng),
        schoolLat,
        schoolLng,
      );

      // ALWAYS enforce GPS — development and production
      if (distance > allowedRadius) {
        return res.status(403).json({
          success: false,
          message: `Check-in denied. You are not on school premises. You are ${(distance * 1000).toFixed(0)} metres away from G.T.C Agidingbi.`,
        });
      }
    }

    // ── QR VALIDATION ─────────────────────────────────────────────
    if (method === "qr") {
      if (!qrToken) {
        return res.status(400).json({
          success: false,
          message:
            "QR token is required. Please scan the QR code at the school gate.",
        });
      }

      if (!VALID_QR_TOKENS.includes(qrToken)) {
        return res.status(403).json({
          success: false,
          message:
            "Invalid QR code. Please scan the official G.T.C Agidingbi gate QR code.",
        });
      }
    }

    // ── CALCULATE LATE STATUS ─────────────────────────────────────
    const checkInTime = new Date();
    const { isLate, lateMinutes } = getLateStatus(checkInTime);

    // ── SAVE ATTENDANCE ───────────────────────────────────────────
    const attendance = await prisma.attendance.create({
      data: {
        userId,
        checkInAt: checkInTime,
        isLate,
        lateMinutes: lateMinutes,
        method,
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
      },
    });

    // ── CREATE LIVE FEED EVENT ────────────────────────────────────
    const user = req.user;
    const teacherName =
      `${user.title || ""} ${user.firstName} ${user.lastName}`.trim();

    await prisma.event.create({
      data: {
        userId,
        type: isLate ? "late" : "checkin",
        detail: isLate
          ? `Checked in late · ${lateMinutes} minute${lateMinutes !== 1 ? "s" : ""} after start time`
          : `Checked in on time · ${method === "qr" ? "QR Code scan" : "GPS verified"}`,
        badge: isLate ? "LATE" : "CHECKED IN",
        badgeClass: isLate ? "fb-orange" : "fb-green",
      },
    });

    // ── EMIT REAL-TIME TO ADMIN ───────────────────────────────────
    const io = req.app.get("io");
    if (io) {
      io.to("admin_room").emit("teacher:checkin", {
        teacherName,
        teacherInitials:
          `${user.firstName[0]}${user.lastName[0]}`.toUpperCase(),
        time: formatTime(checkInTime),
        isLate,
        lateMinutes,
        method,
        badge: isLate ? "LATE" : "CHECKED IN",
        badgeClass: isLate ? "fb-orange" : "fb-green",
        detail: isLate
          ? `Checked in late · ${lateMinutes} mins after start`
          : `Checked in on time · ${method === "qr" ? "QR Code" : "GPS"}`,
      });
      io.to("admin_room").emit("stats:update", await getStats());
    }

    return res.status(201).json({
      success: true,
      message: isLate
        ? `Checked in — ${lateMinutes} minute${lateMinutes !== 1 ? "s" : ""} late`
        : "Checked in on time",
      data: {
        attendance,
        isLate,
        lateMinutes,
        checkInTime: formatTime(checkInTime),
        status: isLate ? "LATE" : "ON TIME",
      },
    });
  } catch (error) {
    console.error("Check-in error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during check-in",
    });
  }
}

// ── CHECK OUT ─────────────────────────────────────────────────────
async function checkOut(req, res) {
  try {
    const userId = req.user.id;

    // Find the most recent attendance record with no checkout
    // Don't filter by date — find the latest unchecked-out record
    const attendance = await prisma.attendance.findFirst({
      where: {
        userId,
        checkOutAt: null,
      },
      orderBy: {
        checkInAt: "desc",
      },
    });

    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: "No active check-in found. Please check in first",
      });
    }

    const checkOutTime = new Date();

    const updated = await prisma.attendance.update({
      where: { id: attendance.id },
      data: { checkOutAt: checkOutTime },
    });

    const user = req.user;
    const teacherName =
      `${user.title || ""} ${user.firstName} ${user.lastName}`.trim();

    await prisma.event.create({
      data: {
        userId,
        type: "checkout",
        detail: `Checked out · Arrived ${formatTime(attendance.checkInAt)} · Left ${formatTime(checkOutTime)}`,
        badge: "CHECKED OUT",
        badgeClass: "fb-purple",
      },
    });

    const io = req.app.get("io");
    if (io) {
      io.to("admin_room").emit("teacher:checkout", {
        teacherName,
        time: formatTime(checkOutTime),
      });
      io.to("admin_room").emit("stats:update", await getStats());
    }

    return res.status(200).json({
      success: true,
      message: "Checked out successfully",
      data: {
        checkOutAt: updated.checkOutAt,
        checkOutTime: formatTime(checkOutTime),
      },
    });
  } catch (error) {
    console.error("Check-out error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during check-out",
    });
  }
}

// ── GET TODAY'S ATTENDANCE ────────────────────────────────────────
async function getTodayAttendance(req, res) {
  try {
    // Get most recent attendance record regardless of date
    const attendance = await prisma.attendance.findFirst({
      where: { userId: req.user.id },
      orderBy: { checkInAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      data: { attendance },
    });
  } catch (error) {
    console.error("Get attendance error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}

// ── STATS HELPER ──────────────────────────────────────────────────
async function getStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [present, late, activeClasses, totalStaff] = await Promise.all([
    prisma.attendance.count({ where: { date: { gte: today } } }),
    prisma.attendance.count({ where: { date: { gte: today }, isLate: true } }),
    prisma.classSession.count({
      where: { date: { gte: today }, endedAt: null },
    }),
    prisma.user.count({ where: { role: "teacher" } }),
  ]);

  return {
    present,
    absent: totalStaff - present,
    late,
    activeClasses,
    totalStaff,
  };
}

module.exports = { checkIn, checkOut, getTodayAttendance, getStats };
