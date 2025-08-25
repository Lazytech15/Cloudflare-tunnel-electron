const express = require("express")
const { getDatabase } = require("../config/database")

const router = express.Router()

// Get all tables
router.get("/", async (req, res) => {
  try {
    const db = getDatabase()
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
router.get("/:tableName/schema", async (req, res) => {
  try {
    const db = getDatabase()
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

// Get table data with pagination
router.get("/:tableName/data", async (req, res) => {
  try {
    const db = getDatabase()
    const { tableName } = req.params
    const { limit = 100, offset = 0 } = req.query

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    // Validate and sanitize limit and offset
    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 100), 1000)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    // Fetch paginated data
    const data = await db.all(`
      SELECT * FROM ${tableName}
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `)

    // Total count
    const total = await db.get(`SELECT COUNT(*) as count FROM ${tableName}`)

    // New hires in last 30 days (requires a 'created_at' column)
    const newHires = await db.get(`
      SELECT COUNT(*) as count FROM ${tableName}
      WHERE created_at >= datetime('now', '-30 days')
    `)

    // Open positions (employees with no department assigned)
    const openPositions = await db.get(`
      SELECT COUNT(*) as count FROM ${tableName}
      WHERE department IS NULL OR department = ''
    `)

    res.json({
      data,
      total: total.count,
      limit: parsedLimit,
      offset: parsedOffset,
      stats: {
        total: total.count,
        newHires: newHires.count,
        openPositions: openPositions.count,
      },
    })
  } catch (error) {
    console.error("Error getting table data:", error)
    res.status(500).json({ error: error.message })
  }
})

// Insert new record
router.post("/:tableName/data", async (req, res) => {
  try {
    const db = getDatabase()
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
router.put("/:tableName/data/:id", async (req, res) => {
  try {
    const db = getDatabase()
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
router.delete("/:tableName/data/:id", async (req, res) => {
  try {
    const db = getDatabase()
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

// Execute custom SQL query
router.post("/query", async (req, res) => {
  try {
    const db = getDatabase()
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

module.exports = router
