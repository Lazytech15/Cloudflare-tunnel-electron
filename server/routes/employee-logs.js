const express = require("express")
const { getDatabase } = require("../config/database")

const router = express.Router()

// Get all employee logs with filtering and pagination
router.get("/", async (req, res) => {
  try {
    const db = getDatabase()
    const { 
      limit = 100, 
      offset = 0, 
      username, 
      date_from, 
      date_to, 
      search 
    } = req.query

    // Validate and sanitize limit and offset
    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 100), 1000)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    // Build WHERE clause based on filters
    let whereConditions = []
    let params = []

    if (username) {
      whereConditions.push("username = ?")
      params.push(username)
    }

    if (date_from) {
      whereConditions.push("log_date >= ?")
      params.push(date_from)
    }

    if (date_to) {
      whereConditions.push("log_date <= ?")
      params.push(date_to)
    }

    if (search) {
      whereConditions.push("(username LIKE ? OR details LIKE ?)")
      params.push(`%${search}%`, `%${search}%`)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // Fetch filtered and paginated logs
    const logs = await db.all(`
      SELECT * FROM employee_logs
      ${whereClause}
      ORDER BY log_date DESC, log_time DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `, params)

    // Get total count for filtered results
    const totalResult = await db.get(`
      SELECT COUNT(*) as count FROM employee_logs
      ${whereClause}
    `, params)

    res.json({
      data: logs,
      total: totalResult.count,
      limit: parsedLimit,
      offset: parsedOffset,
      filters: {
        username,
        date_from,
        date_to,
        search
      }
    })
  } catch (error) {
    console.error("Error getting employee logs:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get employee logs statistics
router.get("/stats", async (req, res) => {
  try {
    const db = getDatabase()
    const { days = 30 } = req.query

    const parsedDays = Math.max(1, Number.parseInt(days) || 30)

    // Total logs count
    const totalLogs = await db.get("SELECT COUNT(*) as count FROM employee_logs")

    // Logs in specified period
    const recentLogs = await db.get(`
      SELECT COUNT(*) as count FROM employee_logs
      WHERE log_date >= date('now', '-${parsedDays} days')
    `)

    // Active users in specified period
    const activeUsers = await db.get(`
      SELECT COUNT(DISTINCT username) as count FROM employee_logs
      WHERE log_date >= date('now', '-${parsedDays} days')
      AND username IS NOT NULL
    `)

    // Logs by day for the specified period
    const logsByDay = await db.all(`
      SELECT 
        log_date,
        COUNT(*) as log_count,
        COUNT(DISTINCT username) as unique_users
      FROM employee_logs
      WHERE log_date >= date('now', '-${parsedDays} days')
      GROUP BY log_date
      ORDER BY log_date DESC
    `)

    // Top active users in specified period
    const topUsers = await db.all(`
      SELECT 
        username,
        COUNT(*) as log_count,
        MAX(log_date) as last_activity
      FROM employee_logs
      WHERE log_date >= date('now', '-${parsedDays} days')
      AND username IS NOT NULL
      GROUP BY username
      ORDER BY log_count DESC
      LIMIT 10
    `)

    res.json({
      period_days: parsedDays,
      total_logs: totalLogs.count,
      recent_logs: recentLogs.count,
      active_users: activeUsers.count,
      logs_by_day: logsByDay,
      top_users: topUsers
    })
  } catch (error) {
    console.error("Error getting employee logs stats:", error)
    res.status(500).json({ error: error.message })
  }
})

// Create new employee log entry
router.post("/", async (req, res) => {
  try {
    const db = getDatabase()
    const { username, details, log_date, log_time } = req.body

    if (!username && !details) {
      return res.status(400).json({ error: "Either username or details must be provided" })
    }

    // Prepare data object
    const logData = {}
    
    if (username) logData.username = username
    if (details) logData.details = details
    if (log_date) logData.log_date = log_date
    if (log_time) logData.log_time = log_time

    const columns = Object.keys(logData).join(", ")
    const placeholders = Object.keys(logData).map(() => "?").join(", ")
    const values = Object.values(logData)

    const result = await db.run(
      `INSERT INTO employee_logs (${columns}) VALUES (${placeholders})`,
      values
    )

    // Fetch the created log entry
    const createdLog = await db.get(
      "SELECT * FROM employee_logs WHERE id = ?",
      [result.lastID]
    )

    res.json({
      success: true,
      id: result.lastID,
      data: createdLog,
      message: "Employee log created successfully"
    })
  } catch (error) {
    console.error("Error creating employee log:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get logs for a specific user
router.get("/user/:username", async (req, res) => {
  try {
    const db = getDatabase()
    const { username } = req.params
    const { limit = 50, offset = 0, date_from, date_to } = req.query

    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 50), 500)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    let whereConditions = ["username = ?"]
    let params = [username]

    if (date_from) {
      whereConditions.push("log_date >= ?")
      params.push(date_from)
    }

    if (date_to) {
      whereConditions.push("log_date <= ?")
      params.push(date_to)
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`

    const logs = await db.all(`
      SELECT * FROM employee_logs
      ${whereClause}
      ORDER BY log_date DESC, log_time DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `, params)

    const totalResult = await db.get(`
      SELECT COUNT(*) as count FROM employee_logs
      ${whereClause}
    `, params)

    // User activity summary
    const activitySummary = await db.get(`
      SELECT 
        COUNT(*) as total_logs,
        MIN(log_date) as first_activity,
        MAX(log_date) as last_activity,
        COUNT(DISTINCT log_date) as active_days
      FROM employee_logs
      WHERE username = ?
    `, [username])

    res.json({
      username,
      data: logs,
      total: totalResult.count,
      limit: parsedLimit,
      offset: parsedOffset,
      activity_summary: activitySummary
    })
  } catch (error) {
    console.error("Error getting user logs:", error)
    res.status(500).json({ error: error.message })
  }
})

// Update employee log entry
router.put("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params
    const { username, details, log_date, log_time } = req.body

    // Validate ID
    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    // Prepare update data
    const updateData = {}
    if (username !== undefined) updateData.username = username
    if (details !== undefined) updateData.details = details
    if (log_date !== undefined) updateData.log_date = log_date
    if (log_time !== undefined) updateData.log_time = log_time

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No data provided for update" })
    }

    const setClause = Object.keys(updateData).map(key => `${key} = ?`).join(", ")
    const values = [...Object.values(updateData), Number.parseInt(id)]

    const result = await db.run(
      `UPDATE employee_logs SET ${setClause} WHERE id = ?`,
      values
    )

    if (result.changes === 0) {
      return res.status(404).json({ error: "Log entry not found" })
    }

    // Fetch updated log entry
    const updatedLog = await db.get("SELECT * FROM employee_logs WHERE id = ?", [id])

    res.json({
      success: true,
      changes: result.changes,
      data: updatedLog,
      message: "Employee log updated successfully"
    })
  } catch (error) {
    console.error("Error updating employee log:", error)
    res.status(500).json({ error: error.message })
  }
})

// Delete employee log entry
router.delete("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    // Validate ID
    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    // Get log entry before deletion
    const logEntry = await db.get("SELECT * FROM employee_logs WHERE id = ?", [Number.parseInt(id)])

    if (!logEntry) {
      return res.status(404).json({ error: "Log entry not found" })
    }

    const result = await db.run("DELETE FROM employee_logs WHERE id = ?", [Number.parseInt(id)])

    res.json({
      success: true,
      changes: result.changes,
      deleted_entry: logEntry,
      message: "Employee log deleted successfully"
    })
  } catch (error) {
    console.error("Error deleting employee log:", error)
    res.status(500).json({ error: error.message })
  }
})

// Bulk delete logs (by date range or username)
router.delete("/bulk", async (req, res) => {
  try {
    const db = getDatabase()
    const { username, date_from, date_to, confirm } = req.body

    if (!confirm) {
      return res.status(400).json({ error: "Confirmation required for bulk delete" })
    }

    let whereConditions = []
    let params = []

    if (username) {
      whereConditions.push("username = ?")
      params.push(username)
    }

    if (date_from) {
      whereConditions.push("log_date >= ?")
      params.push(date_from)
    }

    if (date_to) {
      whereConditions.push("log_date <= ?")
      params.push(date_to)
    }

    if (whereConditions.length === 0) {
      return res.status(400).json({ error: "At least one filter condition is required" })
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`

    // Get count before deletion
    const countResult = await db.get(`SELECT COUNT(*) as count FROM employee_logs ${whereClause}`, params)

    const result = await db.run(`DELETE FROM employee_logs ${whereClause}`, params)

    res.json({
      success: true,
      deleted_count: result.changes,
      expected_count: countResult.count,
      message: `Successfully deleted ${result.changes} log entries`
    })
  } catch (error) {
    console.error("Error bulk deleting logs:", error)
    res.status(500).json({ error: error.message })
  }
})

module.exports = router