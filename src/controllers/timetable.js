const prisma = require('../prisma')

// ── GET TIMETABLE ─────────────────────────────────────────────────
async function getTimetable(req, res) {
  try {
    const entries = await prisma.timetable.findMany({
      where:   { userId: req.user.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    })

    // Group by day of week
    const timetable = { 1: [], 2: [], 3: [], 4: [], 5: [] }
    entries.forEach(entry => {
      if (timetable[entry.dayOfWeek]) {
        timetable[entry.dayOfWeek].push(entry)
      }
    })

    return res.status(200).json({
      success: true,
      data: { timetable },
    })

  } catch (error) {
    console.error('Get timetable error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error',
    })
  }
}

// ── ADD CLASS TO TIMETABLE ────────────────────────────────────────
async function addToTimetable(req, res) {
  try {
    const { dayOfWeek, startTime, endTime, subject, trade, classYear, room } = req.body

    if (!dayOfWeek || !startTime || !endTime || !subject || !trade || !classYear || !room) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required',
      })
    }

    if (dayOfWeek < 1 || dayOfWeek > 5) {
      return res.status(400).json({
        success: false,
        message: 'Day must be between 1 (Monday) and 5 (Friday)',
      })
    }

    const entry = await prisma.timetable.create({
      data: {
        userId: req.user.id,
        dayOfWeek: parseInt(dayOfWeek),
        startTime,
        endTime,
        subject,
        trade,
        classYear,
        room,
      },
    })

    return res.status(201).json({
      success: true,
      message: `${subject} added to timetable`,
      data: { entry },
    })

  } catch (error) {
    console.error('Add timetable error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error',
    })
  }
}

// ── DELETE FROM TIMETABLE ─────────────────────────────────────────
async function deleteFromTimetable(req, res) {
  try {
    const { id } = req.params

    // Make sure this entry belongs to this teacher
    const entry = await prisma.timetable.findFirst({
      where: { id, userId: req.user.id },
    })

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: 'Timetable entry not found',
      })
    }

    await prisma.timetable.delete({ where: { id } })

    return res.status(200).json({
      success: true,
      message: 'Class removed from timetable',
    })

  } catch (error) {
    console.error('Delete timetable error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error',
    })
  }
}

module.exports = { getTimetable, addToTimetable, deleteFromTimetable }