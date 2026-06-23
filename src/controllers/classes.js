const prisma = require('../prisma')

function formatTime(date) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDuration(startedAt, endedAt) {
  const diffMs   = new Date(endedAt) - new Date(startedAt)
  const diffMins = Math.floor(diffMs / 60000)
  const hours    = Math.floor(diffMins / 60)
  const mins     = diffMins % 60
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

// ── START CLASS ───────────────────────────────────────────────────
async function startClass(req, res) {
  try {
    const { subject, trade, classYear, room } = req.body
    const userId = req.user.id

    // Validate required fields
    if (!subject || !trade || !classYear || !room) {
      return res.status(400).json({
        success: false,
        message: 'Subject, trade, class year and room are required',
      })
    }

    // Check teacher is checked in today
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const attendance = await prisma.attendance.findFirst({
      where: { userId, date: { gte: today } },
    })

    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: 'You must check in before starting a class',
      })
    }

    // Check no active class already running
    const activeClass = await prisma.classSession.findFirst({
      where: { userId, date: { gte: today }, endedAt: null },
    })

    if (activeClass) {
      return res.status(400).json({
        success: false,
        message: `You already have an active class: ${activeClass.subject}. End it before starting a new one.`,
      })
    }

    // Create class session
    const session = await prisma.classSession.create({
      data: {
        userId,
        subject,
        trade,
        classYear,
        room,
        startedAt: new Date(),
      },
    })

    // Create live feed event
    const user        = req.user
    const teacherName = `${user.title || ''} ${user.firstName} ${user.lastName}`.trim()

    await prisma.event.create({
      data: {
        userId,
        type:       'class_start',
        detail:     `Started ${subject} · ${classYear} ${trade} · ${room}`,
        badge:      'CLASS STARTED',
        badgeClass: 'fb-blue',
      },
    })

    // Emit real-time to admin
    const io = req.app.get('io')
    if (io) {
      io.to('admin_room').emit('class:started', {
        sessionId:  session.id,
        teacherName,
        teacherInitials: `${user.firstName[0]}${user.lastName[0]}`.toUpperCase(),
        subject,
        trade,
        classYear,
        room,
        time:       formatTime(session.startedAt),
        detail:     `Started ${subject} · ${classYear} ${trade} · ${room}`,
      })

      // Update active class count
      const activeCount = await prisma.classSession.count({
        where: { date: { gte: today }, endedAt: null },
      })
      io.to('admin_room').emit('stats:update', { activeClasses: activeCount })
    }

    return res.status(201).json({
      success: true,
      message: `${subject} class started`,
      data: { session },
    })

  } catch (error) {
    console.error('Start class error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error',
    })
  }
}

// ── END CLASS ─────────────────────────────────────────────────────
async function endClass(req, res) {
  try {
    const { sessionId } = req.body
    const userId        = req.user.id

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required',
      })
    }

    // Find the session
    const session = await prisma.classSession.findFirst({
      where: { id: sessionId, userId, endedAt: null },
    })

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Active class session not found',
      })
    }

    const endedAt    = new Date()
    const diffMs     = endedAt - new Date(session.startedAt)
    const durationMins = Math.floor(diffMs / 60000)

    // Update session
    const updated = await prisma.classSession.update({
      where: { id: sessionId },
      data:  { endedAt, durationMins },
    })

    // Create live feed event
    const user        = req.user
    const teacherName = `${user.title || ''} ${user.firstName} ${user.lastName}`.trim()

    await prisma.event.create({
      data: {
        userId,
        type:       'class_end',
        detail:     `Ended ${session.subject} · ${formatDuration(session.startedAt, endedAt)} duration`,
        badge:      'CLASS ENDED',
        badgeClass: 'fb-purple',
      },
    })

    // Emit real-time to admin
    const io = req.app.get('io')
    if (io) {
      io.to('admin_room').emit('class:ended', {
        sessionId,
        teacherName,
        subject:      session.subject,
        durationMins,
        duration:     formatDuration(session.startedAt, endedAt),
        time:         formatTime(endedAt),
        detail:       `Ended ${session.subject} · ${formatDuration(session.startedAt, endedAt)} duration`,
      })

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const activeCount = await prisma.classSession.count({
        where: { date: { gte: today }, endedAt: null },
      })
      io.to('admin_room').emit('stats:update', { activeClasses: activeCount })
    }

    return res.status(200).json({
      success: true,
      message: `${session.subject} ended — ${durationMins} minutes`,
      data: { session: updated, durationMins },
    })

  } catch (error) {
    console.error('End class error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error',
    })
  }
}

// ── GET TODAY'S SESSIONS ──────────────────────────────────────────
async function getTodaySessions(req, res) {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const sessions = await prisma.classSession.findMany({
      where:   { userId: req.user.id, date: { gte: today } },
      orderBy: { startedAt: 'desc' },
    })

    return res.status(200).json({
      success: true,
      data: { sessions },
    })

  } catch (error) {
    console.error('Get sessions error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error',
    })
  }
}

// ── GET CLASS HISTORY ─────────────────────────────────────────────
async function getHistory(req, res) {
  try {
    const { filter = 'today' } = req.query
    const userId = req.user.id

    const now   = new Date()
    let dateFrom = new Date()

    if (filter === 'today') {
      dateFrom.setHours(0, 0, 0, 0)
    } else if (filter === 'week') {
      dateFrom.setDate(now.getDate() - 7)
    } else if (filter === 'month') {
      dateFrom.setDate(now.getDate() - 30)
    }

    const sessions = await prisma.classSession.findMany({
      where:   { userId, startedAt: { gte: dateFrom } },
      orderBy: { startedAt: 'desc' },
    })

    const totalDone = sessions.filter(s => s.endedAt).length
    const totalLate = 0 // will be calculated when timetable is connected

    return res.status(200).json({
      success: true,
      data: {
        sessions,
        summary: { totalDone, totalSessions: sessions.length },
      },
    })

  } catch (error) {
    console.error('Get history error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error',
    })
  }
}

module.exports = { startClass, endClass, getTodaySessions, getHistory }