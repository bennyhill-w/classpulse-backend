const prisma = require("../prisma");
const PDFDocument = require("pdfkit");

function formatTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function generateReport(req, res) {
  try {
    const { type = "monthly", dateFrom, dateTo } = req.query;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({
        success: false,
        message: "dateFrom and dateTo are required",
      });
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const [attendance, sessions, teachers] = await Promise.all([
      prisma.attendance.findMany({
        where: { checkInAt: { gte: from, lte: to } },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
              staffId: true,
              trade: true,
            },
          },
        },
        orderBy: { checkInAt: "asc" },
      }),
      prisma.classSession.findMany({
        where: { startedAt: { gte: from, lte: to } },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
              staffId: true,
            },
          },
        },
        orderBy: { startedAt: "asc" },
      }),
      prisma.user.findMany({
        where: { role: "teacher" },
        orderBy: { firstName: "asc" },
      }),
    ]);

    const doc = new PDFDocument({ margin: 50, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Classpulse_${type}_report_${dateFrom}.pdf"`,
    );
    doc.pipe(res);

    const NAVY = "#0F1F47";
    const BLUE = "#2563EB";
    const GREEN = "#10B981";
    const RED = "#EF4444";
    const GRAY = "#64748B";
    const LIGHT = "#F1F5F9";

    doc.rect(0, 0, doc.page.width, 90).fill(NAVY);

    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .fillColor("white")
      .text("Classpulse", 50, 24);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("rgba(255,255,255,0.7)")
      .text("Smart School Monitoring & Attendance Management", 50, 50);
    doc
      .fontSize(10)
      .fillColor("rgba(255,255,255,0.7)")
      .text(
        "Government Technical College (G.T.C) Agidingbi, Ikeja, Lagos",
        50,
        65,
      );

    const reportLabel = type.charAt(0).toUpperCase() + type.slice(1);
    doc.rect(doc.page.width - 160, 20, 110, 28).fill(BLUE);
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("white")
      .text(`${reportLabel} Report`, doc.page.width - 158, 28, {
        width: 106,
        align: "center",
      });

    doc.moveDown(4);
    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .fillColor(NAVY)
      .text("Attendance & Class Activity Report", 50, 110);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor(GRAY)
      .text(`Period: ${formatDate(from)} — ${formatDate(to)}`, 50, 132);
    doc.text(
      `Generated: ${formatDate(new Date())} at ${formatTime(new Date())}`,
      50,
      147,
    );
    doc.text(`Total Staff: ${teachers.length} teachers`, 50, 162);

    doc
      .moveTo(50, 180)
      .lineTo(doc.page.width - 50, 180)
      .strokeColor("#E2E8F0")
      .lineWidth(1)
      .stroke();

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .fillColor(NAVY)
      .text("Summary", 50, 195);

    const totalCheckins = attendance.length;
    const lateCheckins = attendance.filter((a) => a.isLate).length;
    const onTimeCheckins = totalCheckins - lateCheckins;
    const totalSessions = sessions.length;
    const completedSessions = sessions.filter((s) => s.endedAt).length;
    const punctuality =
      totalCheckins > 0
        ? Math.round((onTimeCheckins / totalCheckins) * 100)
        : 0;

    const stats = [
      { label: "Total Check-ins", value: totalCheckins, color: BLUE },
      { label: "On Time", value: onTimeCheckins, color: GREEN },
      { label: "Late Arrivals", value: lateCheckins, color: "#F59E0B" },
      {
        label: "Punctuality Rate",
        value: `${punctuality}%`,
        color: punctuality >= 80 ? GREEN : RED,
      },
      { label: "Classes Started", value: totalSessions, color: BLUE },
      { label: "Classes Completed", value: completedSessions, color: GREEN },
    ];

    const statBoxW = 155;
    const statBoxH = 60;
    stats.forEach((st, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 50 + col * (statBoxW + 12);
      const y = 215 + row * (statBoxH + 10);

      doc.rect(x, y, statBoxW, statBoxH).fill(LIGHT);
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .fillColor(st.color)
        .text(String(st.value), x + 10, y + 8, { width: statBoxW - 20 });
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor(GRAY)
        .text(st.label, x + 10, y + 36, { width: statBoxW - 20 });
    });

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .fillColor(NAVY)
      .text("Teacher Attendance Breakdown", 50, 370);

    const tableTop = 390;
    const cols = {
      name: 50,
      staffId: 210,
      checkins: 290,
      late: 350,
      classes: 410,
      rate: 470,
    };

    doc.rect(50, tableTop, doc.page.width - 100, 22).fill(NAVY);
    doc.fontSize(8).font("Helvetica-Bold").fillColor("white");
    doc.text("TEACHER", cols.name, tableTop + 7);
    doc.text("STAFF ID", cols.staffId, tableTop + 7);
    doc.text("CHECK-INS", cols.checkins, tableTop + 7);
    doc.text("LATE", cols.late, tableTop + 7);
    doc.text("CLASSES", cols.classes, tableTop + 7);
    doc.text("RATE", cols.rate, tableTop + 7);

    let y = tableTop + 22;
    teachers.forEach((teacher, i) => {
      const teacherAtt = attendance.filter((a) => a.userId === teacher.id);
      const teacherSes = sessions.filter((s) => s.userId === teacher.id);
      const teacherLate = teacherAtt.filter((a) => a.isLate).length;
      const rate =
        teacherAtt.length > 0
          ? Math.round(
              ((teacherAtt.length - teacherLate) / teacherAtt.length) * 100,
            )
          : 0;

      if (i % 2 === 0) {
        doc.rect(50, y, doc.page.width - 100, 20).fill("#F8FAFC");
      }

      const teacherName =
        `${teacher.title || ""} ${teacher.firstName} ${teacher.lastName}`.trim();

      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(NAVY)
        .text(teacherName.substring(0, 22), cols.name, y + 6, { width: 155 });
      doc
        .fillColor(GRAY)
        .text(teacher.staffId, cols.staffId, y + 6)
        .text(String(teacherAtt.length), cols.checkins, y + 6);
      doc
        .fillColor(teacherLate > 0 ? "#F59E0B" : GRAY)
        .text(String(teacherLate), cols.late, y + 6);
      doc.fillColor(GRAY).text(String(teacherSes.length), cols.classes, y + 6);
      doc
        .fillColor(rate >= 80 ? GREEN : rate >= 60 ? "#F59E0B" : RED)
        .text(`${rate}%`, cols.rate, y + 6);

      y += 20;

      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }
    });

    if (y < doc.page.height - 150) {
      y += 20;
    } else {
      doc.addPage();
      y = 50;
    }

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .fillColor(NAVY)
      .text("Attendance Log", 50, y);
    y += 20;

    doc.rect(50, y, doc.page.width - 100, 22).fill(NAVY);
    doc.fontSize(8).font("Helvetica-Bold").fillColor("white");
    doc.text("DATE", 50, y + 7);
    doc.text("TEACHER", 140, y + 7);
    doc.text("CHECK-IN", 300, y + 7);
    doc.text("CHECK-OUT", 380, y + 7);
    doc.text("STATUS", 460, y + 7);
    y += 22;

    attendance.slice(0, 50).forEach((att, i) => {
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 50;
      }

      if (i % 2 === 0) {
        doc.rect(50, y, doc.page.width - 100, 18).fill("#F8FAFC");
      }

      const teacherName = att.user
        ? `${att.user.title || ""} ${att.user.firstName} ${att.user.lastName}`.trim()
        : "—";

      doc
        .fontSize(7.5)
        .font("Helvetica")
        .fillColor(NAVY)
        .text(formatDate(att.checkInAt).substring(0, 16), 50, y + 5, {
          width: 85,
        });
      doc
        .fillColor(NAVY)
        .text(teacherName.substring(0, 24), 140, y + 5, { width: 155 });
      doc
        .fillColor(GRAY)
        .text(formatTime(att.checkInAt), 300, y + 5)
        .text(att.checkOutAt ? formatTime(att.checkOutAt) : "—", 380, y + 5);
      doc
        .fillColor(att.isLate ? "#F59E0B" : GREEN)
        .text(
          att.isLate ? `Late (${att.lateMinutes}m)` : "On Time",
          460,
          y + 5,
        );

      y += 18;
    });

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i += 1) {
      doc.switchToPage(i);
      doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(NAVY);
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("rgba(255,255,255,0.6)")
        .text(
          `Classpulse — G.T.C Agidingbi, Ikeja, Lagos  |  Page ${i + 1} of ${pageCount}  |  Confidential`,
          50,
          doc.page.height - 26,
          { width: doc.page.width - 100, align: "center" },
        );
    }

    doc.end();
  } catch (error) {
    console.error("Report error:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ success: false, message: "Failed to generate report" });
    }
  }
}

module.exports = { generateReport };
