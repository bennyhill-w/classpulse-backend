const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma");

// ── HELPERS ──────────────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      staffId: user.staffId,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "24h" },
  );
}

function sanitizeUser(user) {
  // Never send passwordHash to the frontend
  const { passwordHash, ...safe } = user;
  return safe;
}

// ── SIGNUP ───────────────────────────────────────────────────────
async function signup(req, res) {
  try {
    const { firstName, lastName, title, staffId, email, password } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !staffId || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Check if staffId or email already exists
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ staffId }, { email: email.toLowerCase() }],
      },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message:
          existing.staffId === staffId
            ? "Staff ID already registered"
            : "Email already registered",
      });
    }

    // Hash the password — never store plain text
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user in database
    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        title: title || "Mr.",
        staffId,
        email: email.toLowerCase(),
        passwordHash,
        role: "teacher", // signup always creates teacher
      },
    });

    // Generate JWT token
    const token = generateToken(user);

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: {
        user: sanitizeUser(user),
        token,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during signup",
    });
  }
}

// ── LOGIN ────────────────────────────────────────────────────────
async function login(req, res) {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Staff ID/email and password are required",
      });
    }

    // Find user by staffId or email
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ staffId: identifier }, { email: identifier.toLowerCase() }],
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid credentials. Please check your Staff ID and password.",
      });
    }

    // Compare password with hash
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid credentials. Please check your Staff ID and password.",
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: sanitizeUser(user),
        token,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
}

// ── GET CURRENT USER (me) ────────────────────────────────────────
async function getMe(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: { user: sanitizeUser(user) },
    });
  } catch (error) {
    console.error("GetMe error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}

module.exports = { signup, login, getMe };
