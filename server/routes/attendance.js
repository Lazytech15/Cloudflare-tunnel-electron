// server-attendance.js
const express = require("express")
const router = express.Router()

// Get database instance
function getDatabase() {
  const { getDatabase } = require("../config/database")
  return getDatabase()
}

// GET /api/attendance - Get all attendance records with pagination and filtering
router.get("/", async (req, res) => {
  try {
    const db = getDatabase()
    const {
      limit = 50,
      offset = 0,
      employee_uid,
      id_number,
      date,
      clock_type,
      is_late,
      is_synced,
      start_date,
      end_date,
      sort_by = "clock_time",
      sort_order = "DESC"
    } = req.query

    // Build WHERE clause based on filters
    const conditions = []
    const params = []

    if (employee_uid) {
      conditions.push("a.employee_uid = ?")
      params.push(employee_uid)
    }

    if (id_number) {
      conditions.push("a.id_number = ?")
      params.push(id_number)
    }

    if (date) {
      conditions.push("a.date = ?")
      params.push(date)
    }

    if (clock_type) {
      conditions.push("a.clock_type = ?")
      params.push(clock_type)
    }

    if (is_late !== undefined) {
      conditions.push("a.is_late = ?")
      params.push(is_late === "true" ? 1 : 0)
    }

    if (is_synced !== undefined) {
      conditions.push("a.is_synced = ?")
      params.push(is_synced === "true" ? 1 : 0)
    }

    if (start_date && end_date) {
      conditions.push("a.date BETWEEN ? AND ?")
      params.push(start_date, end_date)
    } else if (start_date) {
      conditions.push("a.date >= ?")
      params.push(start_date)
    } else if (end_date) {
      conditions.push("a.date <= ?")
      params.push(end_date)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    // Validate sort parameters
    const allowedSortColumns = ["clock_time", "date", "employee_uid", "id_number", "clock_type", "created_at"]
    const sortColumn = allowedSortColumns.includes(sort_by) ? sort_by : "clock_time"
    const sortDirection = sort_order.toUpperCase() === "ASC" ? "ASC" : "DESC"

    // Main query with employee details
    const query = `
      SELECT 
        a.*,
        e.first_name,
        e.middle_name,
        e.last_name,
        e.department,
        e.position,
        e.email
      FROM attendance a
      LEFT JOIN emp_list e ON a.employee_uid = e.uid
      ${whereClause}
      ORDER BY a.${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `

    const records = await db.all(query, [...params, parseInt(limit), parseInt(offset)])

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM attendance a 
      ${whereClause}
    `
    const totalResult = await db.get(countQuery, params)

    res.json({
      success: true,
      data: records,
      pagination: {
        total: totalResult.total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(totalResult.total / parseInt(limit))
      }
    })

  } catch (error) {
    console.error("Error fetching attendance records:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch attendance records",
      message: error.message
    })
  }
})

// POST /api/attendance - Handle attendance sync from Electron app (matches your existing sync function)
router.post("/", async (req, res) => {
  try {
    const db = getDatabase()
    const { attendance_data } = req.body

    // Handle both single record and array formats
    const records = Array.isArray(attendance_data) ? attendance_data :
      attendance_data ? [attendance_data] :
        Array.isArray(req.body) ? req.body : []

    if (records.length === 0) {
      return res.json({
        success: true,
        message: "No attendance records to process",
        processed_count: 0
      })
    }

    console.log(`Processing ${records.length} attendance records from sync`)

    let processedCount = 0
    let duplicateCount = 0
    let errorCount = 0
    const errors = []

    // Begin transaction for batch processing
    await db.run("BEGIN TRANSACTION")

    try {
      for (let i = 0; i < records.length; i++) {
        const record = records[i]

        try {
          // Validate required fields
          if (!record.employee_uid || !record.clock_type || !record.clock_time || !record.date) {
            errors.push({
              index: i,
              error: "Missing required fields",
              record_id: record.id || 'unknown'
            })
            errorCount++
            continue
          }

          // Check for duplicate based on unique combination
          const existingRecord = await db.get(`
            SELECT id FROM attendance 
            WHERE employee_uid = ? AND clock_time = ? AND date = ? AND clock_type = ?
          `, [record.employee_uid, record.clock_time, record.date, record.clock_type])

          if (existingRecord) {
            duplicateCount++
            console.log(`Duplicate record found for employee ${record.employee_uid} on ${record.date} at ${record.clock_time}`)
            continue
          }

          // Ensure employee exists
          const employee = await db.get("SELECT uid FROM emp_list WHERE uid = ?", [record.employee_uid])
          if (!employee) {
            errors.push({
              index: i,
              error: "Employee not found",
              employee_uid: record.employee_uid
            })
            errorCount++
            continue
          }

          // Insert the attendance record
          await db.run(`
            INSERT INTO attendance (
              employee_uid, id_number, clock_type, clock_time, regular_hours,
              overtime_hours, date, is_late, notes, location, ip_address,
              device_info, is_synced, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `, [
            record.employee_uid,
            record.id_number || null,
            record.clock_type,
            record.clock_time,
            record.regular_hours || 0,
            record.overtime_hours || 0,
            record.date,
            record.is_late || 0,
            record.notes || null,
            record.location || null,
            record.ip_address || null,
            record.device_info || null,
            1, // Mark as synced since it's coming from client
            record.created_at || new Date().toISOString()
          ])

          processedCount++

        } catch (recordError) {
          console.error(`Error processing record ${i}:`, recordError)
          errors.push({
            index: i,
            error: recordError.message,
            employee_uid: record.employee_uid
          })
          errorCount++
        }
      }

      await db.run("COMMIT")

      // Emit socket event for synced records if any were processed
      if (processedCount > 0) {
        const { socketEvents } = require("../config/socket")
        socketEvents.attendanceSynced({ synced_count: processedCount })
      }

      // Send success response matching your existing sync expectation
      res.json({
        success: true,
        message: `Successfully processed ${processedCount} attendance records`,
        processed_count: processedCount,
        duplicate_count: duplicateCount,
        error_count: errorCount,
        total_submitted: records.length,
        errors: errors.length > 0 ? errors : undefined
      })

    } catch (transactionError) {
      await db.run("ROLLBACK")
      throw transactionError
    }

  } catch (error) {
    console.error("Error in attendance sync:", error)
    res.status(500).json({
      success: false,
      error: "Failed to process attendance sync",
      message: error.message
    })
  }
})

// POST /api/attendance/record - Create single attendance record (for direct API usage)
router.post("/record", async (req, res) => {
  try {
    const db = getDatabase()
    const {
      employee_uid,
      id_number,
      clock_type,
      clock_time,
      regular_hours = 0,
      overtime_hours = 0,
      date,
      is_late = 0,
      notes,
      location,
      ip_address,
      device_info
    } = req.body

    // Validate required fields
    if (!employee_uid || !clock_type || !clock_time || !date) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["employee_uid", "clock_type", "clock_time", "date"]
      })
    }

    // Validate clock_type
    const validClockTypes = ["morning_in", "morning_out", "afternoon_in", "afternoon_out", "overtime_in", "overtime_out"]
    if (!validClockTypes.includes(clock_type)) {
      return res.status(400).json({
        success: false,
        error: "Invalid clock_type",
        valid_types: validClockTypes
      })
    }

    // Check if employee exists
    const employee = await db.get("SELECT uid FROM emp_list WHERE uid = ?", [employee_uid])
    if (!employee) {
      return res.status(400).json({
        success: false,
        error: "Employee not found"
      })
    }

    // Check for duplicates
    const existingRecord = await db.get(`
      SELECT id FROM attendance 
      WHERE employee_uid = ? AND clock_time = ? AND date = ? AND clock_type = ?
    `, [employee_uid, clock_time, date, clock_type])

    if (existingRecord) {
      return res.status(409).json({
        success: false,
        error: "Duplicate attendance record",
        existing_id: existingRecord.id
      })
    }

    const result = await db.run(`
      INSERT INTO attendance (
        employee_uid, id_number, clock_type, clock_time, regular_hours, 
        overtime_hours, date, is_late, notes, location, ip_address, device_info, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      employee_uid, id_number, clock_type, clock_time, regular_hours,
      overtime_hours, date, is_late, notes, location, ip_address, device_info
    ])

    // Fetch the created record with employee details
    const newRecord = await db.get(`
      SELECT 
        a.*,
        e.first_name,
        e.middle_name,
        e.last_name,
        e.department,
        e.position
      FROM attendance a
      LEFT JOIN emp_list e ON a.employee_uid = e.uid
      WHERE a.id = ?
    `, [result.lastID])

    if (result.changes > 0) {
      // Emit socket event for new attendance record
      const { socketEvents } = require("../config/socket")
      socketEvents.attendanceCreated(newRecord)
    }

    res.status(201).json({
      success: true,
      message: "Attendance record created successfully",
      data: newRecord
    })

  } catch (error) {
    console.error("Error creating attendance record:", error)
    res.status(500).json({
      success: false,
      error: "Failed to create attendance record",
      message: error.message
    })
  }
})

// GET /api/attendance/unsynced - Get unsynced attendance records
router.get("/unsynced", async (req, res) => {
  try {
    const db = getDatabase()
    const { limit = 100 } = req.query

    const records = await db.all(`
      SELECT 
        a.*,
        e.first_name,
        e.middle_name,
        e.last_name,
        e.department,
        e.position
      FROM attendance a
      LEFT JOIN emp_list e ON a.employee_uid = e.uid
      WHERE a.is_synced = 0
      ORDER BY a.created_at DESC
      LIMIT ?
    `, [parseInt(limit)])

    const totalUnsynced = await db.get("SELECT COUNT(*) as count FROM attendance WHERE is_synced = 0")

    res.json({
      success: true,
      data: records,
      total_unsynced: totalUnsynced.count
    })

  } catch (error) {
    console.error("Error fetching unsynced records:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch unsynced records",
      message: error.message
    })
  }
})

// POST /api/attendance/mark-synced - Mark records as synced
router.post("/mark-synced", async (req, res) => {
  try {
    const db = getDatabase()
    const { record_ids } = req.body

    if (!Array.isArray(record_ids) || record_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "record_ids array is required"
      })
    }

    const placeholders = record_ids.map(() => '?').join(',')
    const result = await db.run(`
      UPDATE attendance 
      SET is_synced = 1, updated_at = CURRENT_TIMESTAMP 
      WHERE id IN (${placeholders})
    `, record_ids)

    res.json({
      success: true,
      message: `Marked ${result.changes} records as synced`,
      updated_count: result.changes
    })

    if (result.changes > 0) {
      const { socketEvents } = require("../config/socket")
      socketEvents.attendanceSynced({ synced_count: result.changes })
    }

  } catch (error) {
    console.error("Error marking records as synced:", error)
    res.status(500).json({
      success: false,
      error: "Failed to mark records as synced",
      message: error.message
    })
  }
})

// GET /api/attendance/stats - Get attendance statistics
router.get("/stats", async (req, res) => {
  try {
    const db = getDatabase()
    const { date = new Date().toISOString().split('T')[0] } = req.query

    // Today's statistics
    const todayStats = await db.get(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT employee_uid) as unique_employees,
        SUM(regular_hours) as total_regular_hours,
        SUM(overtime_hours) as total_overtime_hours,
        SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late_count,
        COUNT(CASE WHEN clock_type LIKE '%_in' THEN 1 END) as clock_ins,
        COUNT(CASE WHEN clock_type LIKE '%_out' THEN 1 END) as clock_outs
      FROM attendance 
      WHERE date = ?
    `, [date])

    // Unsynced count
    const unsyncedResult = await db.get("SELECT COUNT(*) as count FROM attendance WHERE is_synced = 0")

    // Recent activity (last 10 records)
    const recentActivity = await db.all(`
      SELECT 
        a.clock_time,
        a.clock_type,
        a.employee_uid,
        e.first_name,
        e.last_name
      FROM attendance a
      LEFT JOIN emp_list e ON a.employee_uid = e.uid
      ORDER BY a.created_at DESC
      LIMIT 10
    `)

    res.json({
      success: true,
      data: {
        date: date,
        statistics: todayStats,
        unsynced_count: unsyncedResult.count,
        recent_activity: recentActivity
      }
    })

  } catch (error) {
    console.error("Error fetching attendance statistics:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch attendance statistics",
      message: error.message
    })
  }
})

// GET /api/attendance/:id - Get specific attendance record
router.get("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    const record = await db.get(`
      SELECT 
        a.*,
        e.first_name,
        e.middle_name,
        e.last_name,
        e.department,
        e.position,
        e.email
      FROM attendance a
      LEFT JOIN emp_list e ON a.employee_uid = e.uid
      WHERE a.id = ?
    `, [id])

    if (!record) {
      return res.status(404).json({
        success: false,
        error: "Attendance record not found"
      })
    }

    res.json({
      success: true,
      data: record
    })

  } catch (error) {
    console.error("Error fetching attendance record:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch attendance record",
      message: error.message
    })
  }
})

// PUT /api/attendance/:id - Update attendance record
router.put("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params
    const {
      employee_uid,
      id_number,
      clock_type,
      clock_time,
      regular_hours,
      overtime_hours,
      date,
      is_late,
      is_synced,
      notes,
      location,
      ip_address,
      device_info
    } = req.body

    // Check if record exists
    const existingRecord = await db.get("SELECT id FROM attendance WHERE id = ?", [id])
    if (!existingRecord) {
      return res.status(404).json({
        success: false,
        error: "Attendance record not found"
      })
    }

    // Validate clock_type if provided
    if (clock_type) {
      const validClockTypes = ["morning_in", "morning_out", "afternoon_in", "afternoon_out", "overtime_in", "overtime_out"]
      if (!validClockTypes.includes(clock_type)) {
        return res.status(400).json({
          success: false,
          error: "Invalid clock_type",
          valid_types: validClockTypes
        })
      }
    }

    // Build update query dynamically
    const updates = []
    const params = []

    const fields = {
      employee_uid, id_number, clock_type, clock_time, regular_hours,
      overtime_hours, date, is_late, is_synced, notes, location, ip_address, device_info
    }

    for (const [field, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates.push(`${field} = ?`)
        params.push(value)
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields to update"
      })
    }

    // Add updated_at timestamp
    updates.push("updated_at = CURRENT_TIMESTAMP")
    params.push(id)

    await db.run(`
  UPDATE attendance 
  SET ${updates.join(", ")}
  WHERE id = ?
`, params)

    // Fetch updated record with employee details
    const updatedRecord = await db.get(`
  SELECT 
    a.*,
    e.first_name,
    e.middle_name,
    e.last_name,
    e.department,
    e.position
  FROM attendance a
  LEFT JOIN emp_list e ON a.employee_uid = e.uid
  WHERE a.id = ?
`, [id])

    // Emit socket event BEFORE response
    const { socketEvents } = require("../config/socket")
    socketEvents.attendanceUpdated(updatedRecord)

    res.json({
      success: true,
      message: "Attendance record updated successfully",
      data: updatedRecord
    })

  } catch (error) {
    console.error("Error updating attendance record:", error)
    res.status(500).json({
      success: false,
      error: "Failed to update attendance record",
      message: error.message
    })
  }
})

// DELETE /api/attendance/:id - Delete attendance record
router.delete("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    // Check if record exists
    const existingRecord = await db.get("SELECT id FROM attendance WHERE id = ?", [id])
    if (!existingRecord) {
      return res.status(404).json({
        success: false,
        error: "Attendance record not found"
      })
    }

    const result = await db.run("DELETE FROM attendance WHERE id = ?", [id])

    // Emit socket event BEFORE response
    const { socketEvents } = require("../config/socket")
    socketEvents.attendanceDeleted({ id: parseInt(id) })

    result.json({
      success: true,
      message: "Attendance record deleted successfully"
    })

  } catch (error) {
    console.error("Error deleting attendance record:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete attendance record",
      message: error.message
    })
  }
})

// GET /api/attendance/employee/:employee_uid - Get attendance records for specific employee
router.get("/employee/:employee_uid", async (req, res) => {
  try {
    const db = getDatabase()
    const { employee_uid } = req.params
    const {
      limit = 50,
      offset = 0,
      start_date,
      end_date,
      clock_type
    } = req.query

    const conditions = ["a.employee_uid = ?"]
    const params = [employee_uid]

    if (start_date && end_date) {
      conditions.push("a.date BETWEEN ? AND ?")
      params.push(start_date, end_date)
    }

    if (clock_type) {
      conditions.push("a.clock_type = ?")
      params.push(clock_type)
    }

    const records = await db.all(`
      SELECT 
        a.*,
        e.first_name,
        e.middle_name,
        e.last_name,
        e.department,
        e.position
      FROM attendance a
      LEFT JOIN emp_list e ON a.employee_uid = e.uid
      WHERE ${conditions.join(" AND ")}
      ORDER BY a.date DESC, a.clock_time DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)])

    const totalResult = await db.get(`
      SELECT COUNT(*) as total 
      FROM attendance a 
      WHERE ${conditions.join(" AND ")}
    `, params)

    res.json({
      success: true,
      data: records,
      pagination: {
        total: totalResult.total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    })

  } catch (error) {
    console.error("Error fetching employee attendance records:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch employee attendance records",
      message: error.message
    })
  }
})

// GET /api/attendance/summary/:employee_uid - Get attendance summary for employee
router.get("/summary/:employee_uid", async (req, res) => {
  try {
    const db = getDatabase()
    const { employee_uid } = req.params
    const { start_date, end_date } = req.query

    let dateCondition = ""
    const params = [employee_uid]

    if (start_date && end_date) {
      dateCondition = "AND date BETWEEN ? AND ?"
      params.push(start_date, end_date)
    }

    const summary = await db.get(`
      SELECT 
        COUNT(*) as total_records,
        SUM(regular_hours) as total_regular_hours,
        SUM(overtime_hours) as total_overtime_hours,
        SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late_count,
        COUNT(DISTINCT date) as days_worked
      FROM attendance 
      WHERE employee_uid = ? ${dateCondition}
    `, params)

    // Get clock type breakdown
    const clockTypeBreakdown = await db.all(`
      SELECT 
        clock_type,
        COUNT(*) as count
      FROM attendance 
      WHERE employee_uid = ? ${dateCondition}
      GROUP BY clock_type
    `, params)

    res.json({
      success: true,
      data: {
        summary,
        clock_type_breakdown: clockTypeBreakdown
      }
    })

  } catch (error) {
    console.error("Error fetching attendance summary:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch attendance summary",
      message: error.message
    })
  }
})

module.exports = router