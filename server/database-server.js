

process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('util._extend')) {
    return; // Ignore this specific warning
  }
  console.warn(warning.message);
});

// Better approach for production module resolution
const path = require("path")
const { spawn } = require("child_process")
const fs = require("fs")
const net = require('net');

// Determine if we're in development or production
const isDev = process.env.NODE_ENV === "development" || process.defaultApp

if (!isDev && process.env.NODE_PATH) {
  // In production, ensure module paths are set up correctly
  const Module = require("module")

  // Get the original require function
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


const express = require("express")
const sqlite3 = require("sqlite3")
const { open } = require("sqlite")
const cors = require("cors")
const { createProxyMiddleware } = require("http-proxy-middleware")

const app = express()
const PORT = process.env.PORT || 3001
const VITE_PORT = 5173

let viteProcess = null

// Function to find npm executable and get proper spawn options
function getNpmSpawnConfig() {
  const isWindows = process.platform === "win32"
  
  if (isWindows) {
    // On Windows, we need to use shell: true or cmd /c
    // Try different approaches
    const npmCommands = ['npm.cmd', 'npm.exe', 'npm']
    
    for (const npmCmd of npmCommands) {
      try {
        const { execSync } = require("child_process")
        execSync(`${npmCmd} --version`, { stdio: 'ignore' })
        return {
          command: npmCmd,
          options: { shell: true }
        }
      } catch (error) {
        // Continue to next option
      }
    }
    
    // Try with cmd /c approach
    try {
      const { execSync } = require("child_process")
      execSync('npm --version', { stdio: 'ignore' })
      return {
        command: 'cmd',
        args: ['/c', 'npm'],
        options: {}
      }
    } catch (error) {
      // Continue
    }
    
    // Try common installation paths
    const commonPaths = [
      path.join(process.env.APPDATA || '', 'npm', 'npm.cmd'),
      path.join(process.env.PROGRAMFILES || '', 'nodejs', 'npm.cmd'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'nodejs', 'npm.cmd'),
      'C:\\Program Files\\nodejs\\npm.cmd',
      'C:\\Program Files (x86)\\nodejs\\npm.cmd'
    ]
    
    for (const npmPath of commonPaths) {
      if (fs.existsSync(npmPath)) {
        return {
          command: npmPath,
          options: {}
        }
      }
    }
  } else {
    // Unix-like systems
    try {
      const { execSync } = require("child_process")
      execSync('npm --version', { stdio: 'ignore' })
      return {
        command: 'npm',
        options: {}
      }
    } catch (error) {
      // npm not found
    }
  }
  
  return null
}

async function startViteServer() {
  return new Promise((resolve, reject) => {
    console.log("🚀 Starting React Vite development server...")

    // Get the web-app directory path
    const webAppDir = path.join(__dirname, "..", "web-app")
    console.log(`📁 Vite project directory: ${webAppDir}`)

    // Check if web-app directory exists
    if (!fs.existsSync(webAppDir)) {
      const error = new Error(`Web app directory not found at: ${webAppDir}`)
      console.error("❌", error.message)
      console.log("⚠️ Continuing without Vite server - serving static files only")
      resolve()
      return
    }

    // Check if package.json exists
    const packageJsonPath = path.join(webAppDir, "package.json")
    if (!fs.existsSync(packageJsonPath)) {
      console.log("⚠️ No package.json found in web-app directory, skipping Vite server")
      resolve()
      return
    }

    // Get npm spawn configuration
    const npmConfig = getNpmSpawnConfig()
    if (!npmConfig) {
      console.log("⚠️ npm not found in PATH or common locations")
      console.log("💡 Trying alternative approaches...")
      
      // Try using node directly to run vite
      const viteScript = path.join(webAppDir, "node_modules", ".bin", "vite")
      const viteScriptJs = path.join(webAppDir, "node_modules", ".bin", "vite.js")
      
      if (fs.existsSync(viteScript)) {
        console.log("🔧 Found local vite installation, trying direct execution...")
        viteProcess = spawn("node", [viteScript], {
          cwd: webAppDir,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PORT: VITE_PORT.toString(),
            HOST: "0.0.0.0",
          },
        })
      } else if (fs.existsSync(viteScriptJs)) {
        console.log("🔧 Found local vite.js, trying direct execution...")
        viteProcess = spawn("node", [viteScriptJs], {
          cwd: webAppDir,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PORT: VITE_PORT.toString(),
            HOST: "0.0.0.0",
          },
        })
      } else {
        console.log("⚠️ Cannot start Vite server - npm and vite not found")
        console.log("💡 Consider running 'npm install' in the web-app directory first")
        resolve()
        return
      }
    } else {
      console.log(`✅ Found npm configuration: ${npmConfig.command}`)
      
      // Start Vite dev server using found npm configuration
      const spawnArgs = npmConfig.args ? [...npmConfig.args, "run", "dev"] : ["run", "dev"]
      const spawnOptions = {
        cwd: webAppDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PORT: VITE_PORT.toString(),
          HOST: "0.0.0.0",
        },
        ...npmConfig.options
      }
      
      console.log(`🔧 Spawning: ${npmConfig.command} ${spawnArgs.join(' ')}`)
      viteProcess = spawn(npmConfig.command, spawnArgs, spawnOptions)
    }

    if (!viteProcess) {
      console.log("⚠️ Could not start Vite process")
      resolve()
      return
    }

    let serverStarted = false

    viteProcess.stdout.on("data", (data) => {
      const output = data.toString()
      console.log("[VITE]:", output)

      // Check if Vite server is ready
      if ((output.includes("Local:") || output.includes("ready in")) && !serverStarted) {
        serverStarted = true
        console.log(`✅ Vite server started on port ${VITE_PORT}`)
        resolve()
      }
    })

    viteProcess.stderr.on("data", (data) => {
      const output = data.toString()
      console.log("[VITE ERROR]:", output)
    })

    viteProcess.on("error", (error) => {
      console.error("❌ Vite process error:", error)
      console.log("⚠️ Continuing without Vite server")
      viteProcess = null
      resolve() // Don't reject, continue without Vite
    })

    viteProcess.on("exit", (code, signal) => {
      console.log(`Vite process exited with code ${code} and signal ${signal}`)
      viteProcess = null
    })

    // Timeout fallback
    setTimeout(() => {
      if (!serverStarted) {
        console.log("⏰ Vite server start timeout, continuing anyway...")
        resolve()
      }
    }, 30000) // 30 second timeout for Vite to start
  })
}

// Middleware
app.use(cors())
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

// Database setup
let db

async function initDatabase() {
  try {
    // Use DATABASE_DIR environment variable if provided (from main process)
    // Otherwise use current working directory
    const databaseDir = process.env.DATABASE_DIR || process.cwd()
    const dbPath = path.join(databaseDir, "database.db")

    console.log(`📂 Database directory: ${databaseDir}`)
    console.log(`📄 Database path: ${dbPath}`)
    console.log(`🔧 Current working directory: ${process.cwd()}`)
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`)

    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    console.log("✅ Connected to SQLite database")

    // Create a sample table if it doesn't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sample_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Insert sample data if table is empty
    const count = await db.get("SELECT COUNT(*) as count FROM sample_data")
    if (count.count === 0) {
      await db.run(`INSERT INTO sample_data (name, value) VALUES 
        ('Sample Entry 1', 'This is a test value'),
        ('Sample Entry 2', 'Another test value'),
        ('Sample Entry 3', 'Third test value')
      `)
      console.log("📝 Inserted sample data")
    }

    console.log("🚀 Database initialized successfully")
    console.log(`📊 Database location: ${dbPath}`)
  } catch (error) {
    console.error("❌ Database initialization error:", error)
    console.error("Stack trace:", error.stack)
    throw error
  }
}

// API Routes

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    database: db ? "connected" : "disconnected",
    viteServer: viteProcess ? "running" : "not running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    databaseDir: process.env.DATABASE_DIR || process.cwd(),
    processInfo: {
      pid: process.pid,
      cwd: process.cwd(),
      execPath: process.execPath,
      platform: process.platform,
    },
  })
})

// Get all tables
app.get("/api/tables", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const tables = await db.all(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `)
    res.json(tables)
  } catch (error) {
    console.error("Error getting tables:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get table schema
app.get("/api/tables/:tableName/schema", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName } = req.params

    // Validate table name to prevent SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    const schema = await db.all(`PRAGMA table_info(${tableName})`)
    res.json(schema)
  } catch (error) {
    console.error("Error getting table schema:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get all records from a table
app.get("/api/tables/:tableName/data", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName } = req.params
    const { limit = 100, offset = 0 } = req.query

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    // Validate and sanitize limit and offset
    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 100), 1000)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    const data = await db.all(`
      SELECT * FROM ${tableName} 
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `)

    const total = await db.get(`SELECT COUNT(*) as count FROM ${tableName}`)

    res.json({
      data,
      total: total.count,
      limit: parsedLimit,
      offset: parsedOffset,
    })
  } catch (error) {
    console.error("Error getting table data:", error)
    res.status(500).json({ error: error.message })
  }
})

// Insert new record
app.post("/api/tables/:tableName/data", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName } = req.params
    const data = req.body

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Invalid data provided" })
    }

    const columns = Object.keys(data).join(", ")
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ")
    const values = Object.values(data)

    const result = await db.run(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`, values)

    res.json({
      success: true,
      id: result.lastID,
      message: "Record inserted successfully",
    })
  } catch (error) {
    console.error("Error inserting record:", error)
    res.status(500).json({ error: error.message })
  }
})

// Update record
app.put("/api/tables/:tableName/data/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName, id } = req.params
    const data = req.body

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    // Validate ID
    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Invalid data provided" })
    }

    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ")
    const values = [...Object.values(data), Number.parseInt(id)]

    const result = await db.run(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`, values)

    if (result.changes === 0) {
      return res.status(404).json({ error: "Record not found" })
    }

    res.json({
      success: true,
      changes: result.changes,
      message: "Record updated successfully",
    })
  } catch (error) {
    console.error("Error updating record:", error)
    res.status(500).json({ error: error.message })
  }
})

// Delete record
app.delete("/api/tables/:tableName/data/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName, id } = req.params

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    // Validate ID
    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    const result = await db.run(`DELETE FROM ${tableName} WHERE id = ?`, [Number.parseInt(id)])

    if (result.changes === 0) {
      return res.status(404).json({ error: "Record not found" })
    }

    res.json({
      success: true,
      changes: result.changes,
      message: "Record deleted successfully",
    })
  } catch (error) {
    console.error("Error deleting record:", error)
    res.status(500).json({ error: error.message })
  }
})

// Execute custom SQL query (GET for SELECT, POST for others)
app.post("/api/query", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { sql, params = [] } = req.body

    if (!sql) {
      return res.status(400).json({ error: "SQL query is required" })
    }

    // Basic validation to prevent obviously dangerous queries
    const trimmedSql = sql.trim().toLowerCase()
    const dangerousKeywords = ["drop", "delete", "truncate", "alter"]
    const isSelect = trimmedSql.startsWith("select")

    if (!isSelect && dangerousKeywords.some((keyword) => trimmedSql.includes(keyword))) {
      return res.status(400).json({ error: "Potentially dangerous query detected" })
    }

    if (isSelect) {
      const result = await db.all(sql, params)
      res.json({ data: result, type: "select" })
    } else {
      const result = await db.run(sql, params)
      res.json({
        success: true,
        changes: result.changes || 0,
        lastID: result.lastID || null,
        type: "modify",
      })
    }
  } catch (error) {
    console.error("Error executing query:", error)
    res.status(500).json({ error: error.message })
  }
})

// Static file serving fallback (if Vite is not running)
const staticPath = path.join(__dirname, "..", "web-app", "dist")
if (fs.existsSync(staticPath)) {
  console.log(`📁 Static files available at: ${staticPath}`)
  app.use(express.static(staticPath))
}

// Vite proxy (only if Vite process is running)
app.use("/", (req, res, next) => {
  if (viteProcess) {
    // Use proxy if Vite is running
    createProxyMiddleware({
      target: `http://localhost:${VITE_PORT}`,
      changeOrigin: true,
      ws: true,
      logLevel: "silent",
      onError: (err, req, res) => {
        console.error("Proxy error:", err.message)
        res.status(500).send("Vite development server not available")
      },
    })(req, res, next)
  } else {
    // Fallback to static files or 404
    const staticPath = path.join(__dirname, "..", "web-app", "dist")
    if (fs.existsSync(staticPath)) {
      express.static(staticPath)(req, res, next)
    } else {
      res.status(404).json({ 
        error: "Frontend not available", 
        message: "Neither Vite dev server nor static build files are available",
        apiAvailable: true,
        apiEndpoint: "/api"
      })
    }
  }
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error)
  res.status(500).json({
    error: "Internal server error",
    message: error.message,
    timestamp: new Date().toISOString(),
  })
})

// Graceful shutdown handling
process.on("SIGTERM", async () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully...")
  if (db) {
    await db.close()
    console.log("🔴 Database connection closed")
  }
  if (viteProcess) {
    viteProcess.kill()
    console.log("🔴 Vite process terminated")
  }
  process.exit(0)
})

process.on("SIGINT", async () => {
  console.log("🛑 Received SIGINT, shutting down gracefully...")
  if (db) {
    await db.close()
    console.log("🔴 Database connection closed")
  }
  if (viteProcess) {
    viteProcess.kill()
    console.log("🔴 Vite process terminated")
  }
  process.exit(0)
})

function findAvailablePort(startPort = 3001) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.listen(startPort, (err) => {
      if (err) {
        // Port is in use, try the next one
        server.close();
        resolve(findAvailablePort(startPort + 1));
      } else {
        const port = server.address().port;
        server.close();
        resolve(port);
      }
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try the next one
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

// Modify the startServer function:
async function startServer() {
  try {
    console.log("🚀 Initializing SQLite Database Server...")
    console.log(`📂 Working directory: ${process.cwd()}`)
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`)
    console.log(`📁 Database directory: ${process.env.DATABASE_DIR || process.cwd()}`)
    console.log(`🖥️ Platform: ${process.platform}`)

    await initDatabase()

    // Find an available port dynamically
    const availablePort = await findAvailablePort(PORT);
    
    if (availablePort !== PORT) {
      console.log(`⚠️ Port ${PORT} is in use, using port ${availablePort} instead`);
    }

    await startViteServer()

    const server = app.listen(availablePort, "0.0.0.0", () => {
      console.log(`✅ Database server running on http://0.0.0.0:${availablePort}`)
      console.log(`📊 Database API available at http://localhost:${availablePort}/api`)
      
      if (viteProcess) {
        console.log(`⚛️ React app (Vite dev) available at http://localhost:${availablePort}`)
      } else {
        const staticPath = path.join(__dirname, "..", "web-app", "dist")
        if (fs.existsSync(staticPath)) {
          console.log(`⚛️ React app (static) available at http://localhost:${availablePort}`)
        } else {
          console.log(`⚠️ Frontend not available - API only mode`)
        }
      }
      
      console.log(`🌐 Server ready for connections on port ${availablePort}`)
    })

    // Handle server errors
    server.on("error", (error) => {
      console.error("❌ Server error:", error)
      process.exit(1)
    })

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("🛑 Received SIGTERM, closing server...")
      server.close(() => {
        console.log("🔴 Server closed")
      })
    })
  } catch (error) {
    console.error("❌ Failed to start server:", error)
    console.error("Stack trace:", error.stack)
    process.exit(1)
  }
}

// Start the server
startServer()