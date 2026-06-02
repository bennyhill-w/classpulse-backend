const express = require("express");
const router = express.Router();
const {
  checkIn,
  checkOut,
  getTodayAttendance,
} = require("../controllers/checkin");
const { protect } = require("../middleware/auth");

// All check-in routes require authentication
router.post("/", protect, checkIn);
router.post("/checkout", protect, checkOut);
router.get("/today", protect, getTodayAttendance);

module.exports = router;
