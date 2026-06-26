const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");

// ── Load environment variables ──────────────────────────────────
dotenv.config();

// ── Create Express app ──────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ── Socket.io setup ─────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5175",
    methods: ["GET", "POST"],
  },
});

// Make io accessible throughout the app
app.set("io", io);

// ── Middleware ───────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5175",
    credentials: true,
  }),
);
app.use(express.json()); // lets us read JSON request bodies
app.use(express.urlencoded({ extended: true }));

// ── Health check ─────────────────────────────────────────────────
// This is a simple endpoint to confirm the server is running
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Classpulse API is running",
    version: "1.0.0",
    school: "G.T.C Agidingbi, Ikeja, Lagos",
  });
});

// ── Routes ───────────────────────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/checkin", require("./routes/checkin"));
app.use("/api/teacher", require("./routes/teacher"));
app.use('/api/admin',   require('./routes/admin'))

// ── 404 handler ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.url} not found`,
  });
});

// ── Global error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

// ── Socket.io connection ─────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Admin joins the admin room to receive live updates
  socket.on("join_admin", () => {
    socket.join("admin_room");
    console.log(`Admin joined admin_room: ${socket.id}`);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ── Start server ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║     Classpulse Backend Server          ║
║     Running on http://localhost:${PORT}   ║
║     G.T.C Agidingbi, Lagos             ║
╚════════════════════════════════════════╝
  `);
});

module.exports = { app, io };
