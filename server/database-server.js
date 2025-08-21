// Better approach for production module resolution
const path = require('path');

// Determine if we're in development or production
const isDev = process.env.NODE_ENV === 'development' || process.defaultApp;

if (!isDev && process.env.NODE_PATH) {
  // In production, ensure module paths are set up correctly
  const Module = require('module');
  
  // Get the original require function
  const originalRequire = Module.prototype.require;
  
  // Override require to handle production paths
  Module.prototype.require = function(id) {
    try {
      return originalRequire.apply(this, arguments);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' && process.env.NODE_PATH) {
        // Try to resolve from NODE_PATH
        const altPath = path.join(process.env.NODE_PATH, id);
        try {
          return originalRequire.call(this, altPath);
        } catch (err2) {
          // If still not found, throw original error
          throw err;
        }
      }
      throw err;
    }
  };
}

const express = require("express")
const sqlite3 = require("sqlite3")
const { open } = require("sqlite")
const cors = require("cors")

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

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
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`)

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
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    databaseDir: process.env.DATABASE_DIR || process.cwd(),
    processInfo: {
      pid: process.pid,
      cwd: process.cwd(),
      execPath: process.execPath
    }
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
    const parsedLimit = Math.min(Math.max(1, parseInt(limit) || 100), 1000)
    const parsedOffset = Math.max(0, parseInt(offset) || 0)

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

    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Invalid data provided" })
    }

    const columns = Object.keys(data).join(", ")
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ")
    const values = Object.values(data)

    const result = await db.run(
      `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`,
      values
    )

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
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Invalid data provided" })
    }

    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ")
    const values = [...Object.values(data), parseInt(id)]

    const result = await db.run(
      `UPDATE ${tableName} SET ${setClause} WHERE id = ?`,
      values
    )

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
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    const result = await db.run(`DELETE FROM ${tableName} WHERE id = ?`, [parseInt(id)])

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
    const dangerousKeywords = ['drop', 'delete', 'truncate', 'alter']
    const isSelect = trimmedSql.startsWith('select')
    
    if (!isSelect && dangerousKeywords.some(keyword => trimmedSql.includes(keyword))) {
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

// Serve API documentation
app.get("/", (req, res) => {
  const protocol = req.get('x-forwarded-proto') || req.protocol
  const host = req.get('host')
  const baseUrl = `${protocol}://${host}`
  const databaseDir = process.env.DATABASE_DIR || process.cwd()
  
  res.send(`
    <html>
      <head>
        <title>SQLite Database API</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 40px; 
            line-height: 1.6; 
            color: #333;
            background: #f8f9fa;
          }
          .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .endpoint { background: #f8f9fa; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #007bff; }
          .method { font-weight: bold; color: #007bff; padding: 4px 8px; background: #e3f2fd; border-radius: 4px; font-size: 0.9em; }
          .url { font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; background: #e9ecef; padding: 8px 12px; border-radius: 4px; margin: 8px 0; display: inline-block; }
          h1 { color: #2c3e50; margin-bottom: 10px; }
          h2 { color: #34495e; border-bottom: 2px solid #ecf0f1; padding-bottom: 10px; margin-top: 40px; }
          pre { background: #2d3748; color: #e2e8f0; padding: 20px; border-radius: 8px; overflow-x: auto; }
          .status { color: #28a745; font-weight: bold; }
          .info { background: #d1ecf1; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #bee5eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🗄️ SQLite Database API</h1>
          <p class="status">✅ Database server is running and ready!</p>
          <p>Your database is now publicly accessible through this REST API.</p>
          
          <div class="info">
            <h3>🔧 Server Information</h3>
            <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
            <p><strong>Database Location:</strong> ${path.join(databaseDir, 'database.db')}</p>
            <p><strong>Server Started:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Node.js Version:</strong> ${process.version}</p>
            <p><strong>Process ID:</strong> ${process.pid}</p>
          </div>
          
          <h2>🔗 Available Endpoints</h2>
          
          <div class="endpoint">
            <span class="method">GET</span> <span class="url">/api/health</span><br>
            <strong>Description:</strong> Check if the database server is running and healthy
          </div>
          
          <div class="endpoint">
            <span class="method">GET</span> <span class="url">/api/tables</span><br>
            <strong>Description:</strong> Get a list of all tables in the database
          </div>
          
          <div class="endpoint">
            <span class="method">GET</span> <span class="url">/api/tables/{tableName}/schema</span><br>
            <strong>Description:</strong> Get schema information for a specific table
          </div>
          
          <div class="endpoint">
            <span class="method">GET</span> <span class="url">/api/tables/{tableName}/data</span><br>
            <strong>Description:</strong> Get all records from a table<br>
            <strong>Query Parameters:</strong> <code>?limit=100&offset=0</code>
          </div>
          
          <div class="endpoint">
            <span class="method">POST</span> <span class="url">/api/tables/{tableName}/data</span><br>
            <strong>Description:</strong> Insert a new record into a table<br>
            <strong>Body:</strong> JSON object with field values
          </div>
          
          <div class="endpoint">
            <span class="method">PUT</span> <span class="url">/api/tables/{tableName}/data/{id}</span><br>
            <strong>Description:</strong> Update an existing record by ID<br>
            <strong>Body:</strong> JSON object with updated field values
          </div>
          
          <div class="endpoint">
            <span class="method">DELETE</span> <span class="url">/api/tables/{tableName}/data/{id}</span><br>
            <strong>Description:</strong> Delete a record by ID
          </div>
          
          <div class="endpoint">
            <span class="method">POST</span> <span class="url">/api/query</span><br>
            <strong>Description:</strong> Execute custom SQL queries<br>
            <strong>Body:</strong> <code>{"sql": "SELECT * FROM table", "params": []}</code>
          </div>
          
          <h2>📝 Example Usage</h2>
          <pre># Health check
curl ${baseUrl}/api/health

# Get all tables
curl ${baseUrl}/api/tables

# Get sample data
curl "${baseUrl}/api/tables/sample_data/data?limit=10"

# Insert new record
curl -X POST ${baseUrl}/api/tables/sample_data/data \\
  -H "Content-Type: application/json" \\
  -d '{"name": "New Entry", "value": "New Value"}'

# Custom query
curl -X POST ${baseUrl}/api/query \\
  -H "Content-Type: application/json" \\
  -d '{"sql": "SELECT * FROM sample_data WHERE name LIKE ?", "params": ["%Entry%"]}'</pre>

          <h2>🛡️ Security Notes</h2>
          <ul>
            <li>This API includes basic SQL injection protection</li>
            <li>Table names are validated using regex patterns</li>
            <li>Dangerous SQL keywords are filtered in custom queries</li>
            <li>Consider implementing authentication for production use</li>
          </ul>
        </div>
      </body>
    </html>
  `)
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error)
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  })
})

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...')
  if (db) {
    await db.close()
    console.log('🔴 Database connection closed')
  }
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...')
  if (db) {
    await db.close()
    console.log('🔴 Database connection closed')
  }
  process.exit(0)
})

// Start server
async function startServer() {
  try {
    console.log('🚀 Initializing SQLite Database Server...')
    console.log(`📂 Working directory: ${process.cwd()}`)
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`📁 Database directory: ${process.env.DATABASE_DIR || process.cwd()}`)
    
    await initDatabase()

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Database server running on http://0.0.0.0:${PORT}`)
      console.log(`📊 Database API available at http://localhost:${PORT}`)
      console.log(`🌐 Server ready for connections`)
    })

    // Handle server errors
    server.on('error', (error) => {
      console.error('❌ Server error:', error)
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Please choose a different port.`)
        process.exit(1)
      }
    })

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Received SIGTERM, closing server...')
      server.close(() => {
        console.log('🔴 Server closed')
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