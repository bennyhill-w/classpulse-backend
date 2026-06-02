const jwt = require("jsonwebtoken");
const prisma = require("../prisma");

// ── PROTECT ROUTE ────────────────────────────────────────────────
// This middleware runs before any protected endpoint
// It checks the JWT token and attaches the user to req.user
async function protect(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        title: true,
        staffId: true,
        email: true,
        role: true,
        trade: true,
        subjects: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is no longer valid.",
      });
    }

    // Attach user to request — available in all controllers as req.user
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please log in again.",
      });
    }
    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
}

// ── ADMIN ONLY ───────────────────────────────────────────────────
// Use this after protect to restrict endpoints to admin only
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin only.",
    });
  }
  next();
}

module.exports = { protect, adminOnly };
