const express  = require('express')
const router   = express.Router()
const { protect } = require('../middleware/auth')
const {
  startClass, endClass, getTodaySessions, getHistory,
} = require('../controllers/classes')
const {
  getTimetable, addToTimetable, deleteFromTimetable,
} = require('../controllers/timetable')
const prisma = require('../prisma')

// ── CLASS SESSIONS ────────────────────────────────────────────────
router.post('/class/start',    protect, startClass)
router.post('/class/end',      protect, endClass)
router.get('/class/today',     protect, getTodaySessions)
router.get('/class/history',   protect, getHistory)

// ── TIMETABLE ─────────────────────────────────────────────────────
router.get('/timetable',       protect, getTimetable)
router.post('/timetable',      protect, addToTimetable)
router.delete('/timetable/:id',protect, deleteFromTimetable)

// ── PROFILE ───────────────────────────────────────────────────────
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, firstName: true, lastName: true,
        title: true, staffId: true, email: true,
        role: true, trade: true, subjects: true, phone: true,
      },
    })
    res.json({ success: true, data: { user } })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

router.patch('/profile', protect, async (req, res) => {
  try {
    const { firstName, lastName, email, phone } = req.body
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data:  { firstName, lastName, email, phone },
    })
    const { passwordHash, ...safe } = user
    res.json({ success: true, message: 'Profile updated', data: { user: safe } })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// ── NOTIFICATIONS ─────────────────────────────────────────────────
router.get('/notifications', protect, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where:   { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take:    20,
    })
    const unreadCount = notifications.filter(n => !n.read).length
    res.json({ success: true, data: { notifications, unreadCount } })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

module.exports = router