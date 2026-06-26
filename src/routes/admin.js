const express  = require('express')
const router   = express.Router()
const { protect, adminOnly } = require('../middleware/auth')
const {
  getOverview, getFeed, getTeachers, getTeacher,
  updateTeacher, getActiveClasses, sendMessage,
  getAlerts, resolveAlert, getAnalytics,
} = require('../controllers/admin')

// All admin routes require auth + admin role
router.use(protect, adminOnly)

router.get('/overview',          getOverview)
router.get('/feed',              getFeed)
router.get('/teachers',          getTeachers)
router.get('/teachers/:id',      getTeacher)
router.patch('/teachers/:id',    updateTeacher)
router.get('/classes',           getActiveClasses)
router.post('/message',          sendMessage)
router.get('/alerts',            getAlerts)
router.patch('/alerts/:id/resolve', resolveAlert)
router.get('/analytics',         getAnalytics)

module.exports = router