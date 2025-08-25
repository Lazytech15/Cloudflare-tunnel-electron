// Environment variable check at the top
const USE_PRODUCTION_BUILD =
  process.env.USE_PRODUCTION_BUILD === "true" ||
  process.env.NODE_ENV === "production" ||
  process.argv.includes("--production") ||
  process.argv.includes("--prod")

process.on("warning", (warning) => {
  if (warning.name === "DeprecationWarning" && warning.message.includes("util._extend")) {
    return // Ignore this specific warning
  }
  console.warn(warning.message)
})

// Module resolution setup for production
const path = require("path")
const fs = require("fs")

// Determine if we're in development or production
const isDev = process.env.NODE_ENV === "development" || process.defaultApp

if (!isDev && process.env.NODE_PATH) {
  // In production, ensure module paths are set up correctly
  const Module = require("module")
  const originalRequire = Module.prototype.require

  // Override require to handle production paths
  Module.prototype.require = function (id) {
    try {
      return originalRequire.apply(this, arguments)
    } catch (err) {
      if (err.code === "MODULE_NOT_FOUND" && process.env.NODE_PATH) {
        // Try to resolve from NODE_PATH
        const altPath = path.join(process.env.NODE_PATH, id)
        try {
          return originalRequire.call(this, altPath)
        } catch (err2) {
          // If still not found, throw original error
          throw err
        }
      }
      throw err
    }
  }
}

// Core dependencies
const express = require("express")
const cors = require("cors")
const { createProxyMiddleware } = require("http-proxy-middleware")
const http = require("http")
const { initSocket } = require("./config/socket")

// Import our modular components
const { initDatabase } = require("./config/database")
const authRoutes = require("./routes/auth")
const validationRoutes = require("./routes/validation")
const employeeRoutes = require("./routes/employees")
const departmentRoutes = require("./routes/departments")
const tableRoutes = require("./routes/tables")
const uploadRoutes = require("./routes/upload")  
const fileRoutes = require("./routes/files")    

const app = express()
const server = http.createServer(app)
const PORT = process.env.PORT || 3001

const io = initSocket(server)

// Middleware setup
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    credentials: true,
  }),
)

app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  next()
})

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  })
})

// Mount route modules
app.use("/api", authRoutes)
app.use("/api", validationRoutes)
app.use("/api/employees", employeeRoutes)
app.use("/api/departments", departmentRoutes)
app.use("/api/tables", tableRoutes)
app.use("/api/uploads", uploadRoutes) 
app.use("/api/files", fileRoutes)

// Legacy sample data endpoint (keeping for backward compatibility)
app.get("/api/data", async (req, res) => {
  try {
    const { getDatabase } = require("./config/database")
    const db = getDatabase()

    const { limit = 10, offset = 0 } = req.query
    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 10), 100)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    const data = await db.all("SELECT * FROM sample_data ORDER BY created_at DESC LIMIT ? OFFSET ?", [
      parsedLimit,
      parsedOffset,
    ])

    const total = await db.get("SELECT COUNT(*) as count FROM sample_data")

    res.json({
      data,
      total: total.count,
      limit: parsedLimit,
      offset: parsedOffset,
    })
  } catch (error) {
    console.error("Error fetching sample data:", error)
    res.status(500).json({ error: error.message })
  }
})

// Vite development server proxy (if not using production build)
const viteProcess = null
if (!USE_PRODUCTION_BUILD) {
  console.log("🔧 Development mode: Setting up Vite proxy...")

  app.use(
    "/",
    createProxyMiddleware({
      target: "http://localhost:5173",
      changeOrigin: true,
      ws: true,
      onError: (err, req, res) => {
        console.log("Vite proxy error (this is normal if Vite is not running):", err.message)
        res.status(503).json({
          error: "Vite development server not available",
          message: 'Please start the Vite development server with "npm run dev" in the web-app directory',
        })
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log(`Proxying ${req.method} ${req.url} to Vite`)
      },
    }),
  )
}

// Static file serving fallback (if Vite is not running)
const staticPath = path.join(__dirname, "..", "web-app", "dist")
if (fs.existsSync(staticPath)) {
  console.log(`📁 Static files available at: ${staticPath}`)

  // Serve static files with proper headers for SPA
  app.use(
    express.static(staticPath, {
      // Cache static assets for better performance
      maxAge: USE_PRODUCTION_BUILD ? "1y" : 0,
      // Handle client-side routing
      fallthrough: true,
    }),
  )

  // SPA fallback - serve index.html for all non-API routes
  app.get("*", (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith("/api/")) {
      return next()
    }

    // Skip if Vite is handling the request
    if (viteProcess && !USE_PRODUCTION_BUILD) {
      return next()
    }

    // Serve index.html for client-side routing
    res.sendFile(path.join(staticPath, "index.html"))
  })
} else {
  console.log(`⚠️ Static files not found at: ${staticPath}`)
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err)
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: err.message,
  })
})

// 404 handler for API routes
app.use("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "API endpoint not found",
    path: req.path,
  })
})

// Start server
async function startServer() {
  try {
    // Initialize database first
    await initDatabase()

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Database server running on http://0.0.0.0:${PORT}`)
      console.log(`📊 API endpoints available at http://localhost:${PORT}/api/`)
      console.log(`🔌 Socket.IO server running on ws://localhost:${PORT}`)
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`)
      console.log(`📁 Database directory: ${process.env.DATABASE_DIR || process.cwd()}`)

      if (!USE_PRODUCTION_BUILD) {
        console.log(`🔧 Development mode: Vite proxy enabled`)
        console.log(`💡 Start Vite with "npm run dev" in web-app directory for full functionality`)
      }
    })
  } catch (error) {
    console.error("❌ Failed to start server:", error)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...")
  process.exit(0)
})

// Start the server
startServer()
