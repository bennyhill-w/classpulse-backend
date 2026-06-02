const express = require("express");
const router = express.Router();
const { signup, login, getMe } = require("../controllers/auth");
const { protect } = require("../middleware/auth");

// Public routes — no token needed
router.post("/signup", signup);
router.post("/login", login);

// Protected route — token required
router.get("/me", protect, getMe);

module.exports = router;
