const prisma = require('../prisma')

function formatTime(date) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function getInitials(firstName, lastName) {
  return `${(firstName||'?')[0]}${(lastName||'?')[0]}`.toUpperCase()
}

// ── OVERVIEW STATS ────────────────────────────────────────────────
async function getOverview(req, res) {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      present, late, activeClasses,
      idleAlerts, totalStaff,
    ] = await Promise.all([
      prisma.attendance.count({ where: { date: { gte: today } } }),
      prisma.attendance.count({ where: { date: { gte: today }, isLate: true } }),
      prisma.classSession.count({ where: { date: { gte: today }, endedAt: null } }),
      prisma.alert.count({ where: { resolved: false, type: 'danger' } }),
      prisma.user.count({ where: { role: 'teacher' } }),
    ])

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          present,
          absent:      totalStaff - present,
          late,
          activeClasses,
          idleClasses: idleAlerts,
          totalStaff,
        },
      },
    })
  } catch (error) {
    console.error('Overview error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── LIVE FEED ─────────────────────────────────────────────────────
async function getFeed(req, res) {
  try {
    const { limit = 50, type } = req.query
    const where = type && type !== 'all' ? { type } : {}

    const events = await prisma.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    parseInt(limit),
    })

    // Fetch user details separately
    const userIds = [...new Set(events.filter(e => e.userId).map(e => e.userId))]
    const users   = userIds.length > 0
      ? await prisma.user.findMany({
          where:  { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, title: true, staffId: true },
        })
      : []

    const userMap = {}
    users.forEach(u => { userMap[u.id] = u })

    const formatted = events.map(e => {
      const user = e.userId ? userMap[e.userId] : null
      return {
        id:              e.id,
        type:            e.type,
        detail:          e.detail,
        badge:           e.badge,
        badgeClass:      e.badgeClass,
        time:            formatTime(e.createdAt),
        createdAt:       e.createdAt,
        teacherName:     user
          ? `${user.title || ''} ${user.firstName} ${user.lastName}`.trim()
          : 'System',
        teacherInitials: user
          ? getInitials(user.firstName, user.lastName)
          : 'SY',
        staffId:         user?.staffId || '',
      }
    })

    return res.status(200).json({
      success: true,
      data:    { events: formatted },
    })
  } catch (error) {
    console.error('Feed error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── TEACHERS LIST ─────────────────────────────────────────────────
async function getTeachers(req, res) {
  try {
    const { status, search, page = 1, limit = 10 } = req.query
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const searchFilter = search ? {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { staffId:   { contains: search, mode: 'insensitive' } },
        { trade:     { contains: search, mode: 'insensitive' } },
      ],
    } : {}

    const [teachers, total] = await Promise.all([
      prisma.user.findMany({
        where:   { role: 'teacher', ...searchFilter },
        skip,
        take:    parseInt(limit),
        orderBy: { firstName: 'asc' },
      }),
      prisma.user.count({ where: { role: 'teacher', ...searchFilter } }),
    ])

    // Fetch today's attendance and sessions separately
    const teacherIds = teachers.map(t => t.id)

    const [attendances, sessions] = await Promise.all([
      prisma.attendance.findMany({
        where: { userId: { in: teacherIds }, date: { gte: today } },
      }),
      prisma.classSession.findMany({
        where: { userId: { in: teacherIds }, date: { gte: today } },
      }),
    ])

    const attMap = {}
    attendances.forEach(a => { attMap[a.userId] = a })

    const sessionMap = {}
    sessions.forEach(s => {
      if (!sessionMap[s.userId]) sessionMap[s.userId] = []
      sessionMap[s.userId].push(s)
    })

    let formatted = teachers.map(t => {
      const todayAtt     = attMap[t.id]
      const todaySessions = sessionMap[t.id] || []
      const doneSessions  = todaySessions.filter(s => s.endedAt).length

      let todayStatus = 'Absent'
      if (todayAtt) {
        todayStatus = todayAtt.isLate ? 'Late' : 'On Time'
      }

      return {
        id:            t.id,
        name:          `${t.title || ''} ${t.firstName} ${t.lastName}`.trim(),
        firstName:     t.firstName,
        lastName:      t.lastName,
        staffId:       t.staffId,
        email:         t.email,
        phone:         t.phone,
        trade:         t.trade,
        subjects:      t.subjects,
        initials:      getInitials(t.firstName, t.lastName),
        todayStatus,
        checkInTime:   todayAtt ? formatTime(todayAtt.checkInAt) : '—',
        activityToday: todaySessions.length > 0
          ? `${doneSessions}/${todaySessions.length} done`
          : '—',
        attendanceRate: 85,
      }
    })

    // Filter by status after formatting
    if (status && status !== 'all') {
      const statusMap = {
        present: ['On Time', 'Late'],
        late:    ['Late'],
        absent:  ['Absent'],
      }
      if (statusMap[status]) {
        formatted = formatted.filter(t => statusMap[status].includes(t.todayStatus))
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        teachers: formatted,
        pagination: {
          page:       parseInt(page),
          limit:      parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    })
  } catch (error) {
    console.error('Teachers error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── SINGLE TEACHER ────────────────────────────────────────────────
async function getTeacher(req, res) {
  try {
    const { id } = req.params
    const today  = new Date()
    today.setHours(0, 0, 0, 0)

    const teacher = await prisma.user.findUnique({
      where: { id },
    })

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' })
    }

    const [attendance, sessions, timetable] = await Promise.all([
      prisma.attendance.findMany({
        where:   { userId: id, date: { gte: today } },
        take:    1,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.classSession.findMany({
        where:   { userId: id, date: { gte: today } },
        orderBy: { startedAt: 'asc' },
      }),
      prisma.timetable.findMany({
        where:   { userId: id, dayOfWeek: new Date().getDay() },
        orderBy: { startTime: 'asc' },
      }),
    ])

    const { passwordHash, ...safe } = teacher
    return res.status(200).json({
      success: true,
      data: {
        teacher: {
          ...safe,
          todayAttendance: attendance[0] || null,
          todaySessions:   sessions,
          todayTimetable:  timetable,
        },
      },
    })
  } catch (error) {
    console.error('Get teacher error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── UPDATE TEACHER ────────────────────────────────────────────────
async function updateTeacher(req, res) {
  try {
    const { id } = req.params
    const { firstName, lastName, trade, subjects, email, phone } = req.body

    const updated = await prisma.user.update({
      where: { id },
      data:  { firstName, lastName, trade, subjects, email, phone },
    })

    const { passwordHash, ...safe } = updated
    return res.status(200).json({
      success: true,
      message: 'Teacher updated',
      data:    { teacher: safe },
    })
  } catch (error) {
    console.error('Update teacher error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── ACTIVE CLASSES ────────────────────────────────────────────────
async function getActiveClasses(req, res) {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const sessions = await prisma.classSession.findMany({
      where:   { date: { gte: today } },
      orderBy: { startedAt: 'desc' },
    })

    // Fetch teachers separately
    const userIds = [...new Set(sessions.map(s => s.userId))]
    const users   = userIds.length > 0
      ? await prisma.user.findMany({
          where:  { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, title: true, staffId: true },
        })
      : []

    const userMap = {}
    users.forEach(u => { userMap[u.id] = u })

    const formatted = sessions.map(s => {
      const user       = userMap[s.userId]
      const now        = new Date()
      const elapsedMs  = s.endedAt
        ? new Date(s.endedAt) - new Date(s.startedAt)
        : now - new Date(s.startedAt)
      const elapsedMins = Math.floor(elapsedMs / 60000)

      return {
        id:           s.id,
        subject:      s.subject,
        trade:        s.trade,
        classYear:    s.classYear,
        room:         s.room,
        teacher:      user
          ? `${user.title || ''} ${user.firstName} ${user.lastName}`.trim()
          : '—',
        teacherId:    user?.staffId || '—',
        initials:     user ? getInitials(user.firstName, user.lastName) : '??',
        startedAt:    s.startedAt,
        endedAt:      s.endedAt,
        status:       s.endedAt ? 'done' : 'active',
        elapsedMins,
        durationMins: s.durationMins,
      }
    })

    const counts = {
      active:   formatted.filter(s => s.status === 'active').length,
      done:     formatted.filter(s => s.status === 'done').length,
      upcoming: 0,
      absent:   0,
    }

    return res.status(200).json({
      success: true,
      data: { classes: formatted, counts },
    })
  } catch (error) {
    console.error('Active classes error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── SEND MESSAGE ──────────────────────────────────────────────────
async function sendMessage(req, res) {
  try {
    const { recipientId, body } = req.body

    if (!recipientId || !body) {
      return res.status(400).json({
        success: false,
        message: 'Recipient ID and message body are required',
      })
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
    })

    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found',
      })
    }

    const message = await prisma.message.create({
      data: { senderId: req.user.id, recipientId, body },
    })

    await prisma.notification.create({
      data: { userId: recipientId, title: 'Message from Principal', body },
    })

    const io = req.app.get('io')
    if (io) {
      io.to(`teacher_${recipientId}`).emit('notification', {
        title: 'Message from Principal',
        body,
        time:  formatTime(new Date()),
      })
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data:    { messageId: message.id },
    })
  } catch (error) {
    console.error('Send message error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── GET ALERTS ────────────────────────────────────────────────────
async function getAlerts(req, res) {
  try {
    const alerts = await prisma.alert.findMany({
      where:   { resolved: false },
      orderBy: { createdAt: 'desc' },
    })

    return res.status(200).json({
      success: true,
      data: { alerts, count: alerts.length },
    })
  } catch (error) {
    console.error('Alerts error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── RESOLVE ALERT ─────────────────────────────────────────────────
async function resolveAlert(req, res) {
  try {
    await prisma.alert.update({
      where: { id: req.params.id },
      data:  { resolved: true },
    })
    return res.status(200).json({ success: true, message: 'Alert resolved' })
  } catch (error) {
    console.error('Resolve alert error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ── ANALYTICS ─────────────────────────────────────────────────────
async function getAnalytics(req, res) {
  try {
    const { period = 'weekly' } = req.query
    const now      = new Date()
    const dateFrom = new Date()

    if (period === 'weekly')  dateFrom.setDate(now.getDate() - 7)
    if (period === 'monthly') dateFrom.setDate(now.getDate() - 30)
    if (period === 'term')    dateFrom.setDate(now.getDate() - 90)

    const [attendance, sessions, totalStaff] = await Promise.all([
      prisma.attendance.findMany({
        where:  { checkInAt: { gte: dateFrom } },
        select: { checkInAt: true, isLate: true, lateMinutes: true },
      }),
      prisma.classSession.findMany({
        where:  { startedAt: { gte: dateFrom } },
        select: { startedAt: true, durationMins: true },
      }),
      prisma.user.count({ where: { role: 'teacher' } }),
    ])

    const totalCheckins   = attendance.length
    const lateCheckins    = attendance.filter(a => a.isLate).length
    const punctualityRate = totalCheckins > 0
      ? Math.round(((totalCheckins - lateCheckins) / totalCheckins) * 100)
      : 0

    const avgCheckinMs = attendance.length > 0
      ? attendance.reduce((sum, a) => {
          const d = new Date(a.checkInAt)
          return sum + d.getHours() * 60 + d.getMinutes()
        }, 0) / attendance.length
      : 480

    const avgHour        = Math.floor(avgCheckinMs / 60)
    const avgMin         = Math.round(avgCheckinMs % 60)
    const avgCheckinTime = `${avgHour > 12 ? avgHour - 12 : avgHour}:${String(avgMin).padStart(2,'0')} ${avgHour >= 12 ? 'PM' : 'AM'}`

    const days = ['Mon','Tue','Wed','Thu','Fri']
    const dailyCheckins = days.map((day, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (4 - i))
      d.setHours(0, 0, 0, 0)
      const next = new Date(d)
      next.setDate(d.getDate() + 1)
      const count = attendance.filter(a => {
        const t = new Date(a.checkInAt)
        return t >= d && t < next
      }).length
      return { day, count, total: totalStaff }
    })

    return res.status(200).json({
      success: true,
      data: {
        avgCheckinTime,
        punctualityRate:  `${punctualityRate}%`,
        avgClassesPerDay: totalStaff > 0
          ? (sessions.length / 5).toFixed(1)
          : '0',
        absenceRate: totalStaff > 0
          ? `${Math.round((1 - totalCheckins / (totalStaff * 5)) * 100)}%`
          : '0%',
        trend:       punctualityRate >= 80 ? '+4%' : '-2%',
        dailyCheckins,
      },
    })
  } catch (error) {
    console.error('Analytics error:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

module.exports = {
  getOverview, getFeed, getTeachers, getTeacher,
  updateTeacher, getActiveClasses, sendMessage,
  getAlerts, resolveAlert, getAnalytics,
}