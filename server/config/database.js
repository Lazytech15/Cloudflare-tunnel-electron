const path = require("path")
const sqlite3 = require("sqlite3")
const { open } = require("sqlite")

let db = null

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

function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.")
  }
  return db
}

module.exports = {
  initDatabase,
  getDatabase,
}
