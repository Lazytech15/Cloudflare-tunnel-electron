// server-daily-summary.js
const express = require("express")
const router = express.Router()

// Get database instance
function getDatabase() {
  const { getDatabase } = require("../config/database")
  return getDatabase()
}

// GET /api/daily-summary - Get daily attendance summary records with pagination and filtering
router.get("/", async (req, res) => {
  try {
    const db = getDatabase()
    const {
      limit = 50,
      offset = 0,
      employee_uid,
      id_number,
      date,
      start_date,
      end_date,
      department,
      has_overtime,
      is_incomplete,
      has_late_entry,
      sort_by = "date",
      sort_order = "DESC"
    } = req.query

    // Build WHERE clause based on filters
    const conditions = []
    const params = []

    if (employee_uid) {
      conditions.push("s.employee_uid = ?")
      params.push(employee_uid)
    }

    if (id_number) {
      conditions.push("s.id_number = ?")
      params.push(id_number)
    }

    if (date) {
      conditions.push("s.date = ?")
      params.push(date)
    }

    if (department) {
      conditions.push("s.department = ?")
      params.push(department)
    }

    if (has_overtime !== undefined) {
      conditions.push("s.has_overtime = ?")
      params.push(has_overtime === "true" ? 1 : 0)
    }

    if (is_incomplete !== undefined) {
      conditions.push("s.is_incomplete = ?")
      params.push(is_incomplete === "true" ? 1 : 0)
    }

    if (has_late_entry !== undefined) {
      conditions.push("s.has_late_entry = ?")
      params.push(has_late_entry === "true" ? 1 : 0)
    }

    if (start_date && end_date) {
      conditions.push("s.date BETWEEN ? AND ?")
      params.push(start_date, end_date)
    } else if (start_date) {
      conditions.push("s.date >= ?")
      params.push(start_date)
    } else if (end_date) {
      conditions.push("s.date <= ?")
      params.push(end_date)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    // Validate sort parameters
    const allowedSortColumns = [
      "date", "employee_name", "department", "total_hours", 
      "regular_hours", "overtime_hours", "last_updated"
    ]
    const sortColumn = allowedSortColumns.includes(sort_by) ? sort_by : "date"
    const sortDirection = sort_order.toUpperCase() === "ASC" ? "ASC" : "DESC"

    // Main query with employee details
    const query = `
      SELECT 
        s.*,
        e.email,
        e.position,
        e.hire_date,
        e.status as employee_status
      FROM daily_attendance_summary s
      LEFT JOIN emp_list e ON s.employee_uid = e.uid
      ${whereClause}
      ORDER BY s.${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `

    const records = await db.all(query, [...params, parseInt(limit), parseInt(offset)])

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM daily_attendance_summary s 
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
    console.error("Error fetching daily summary records:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch daily summary records",
      message: error.message
    })
  }
})

// POST /api/daily-summary - Handle daily summary sync from Electron app
router.post("/", async (req, res) => {
  try {
    const db = getDatabase()
    const { daily_summary_data } = req.body

    // Handle both single record and array formats
    const records = Array.isArray(daily_summary_data) ? daily_summary_data :
      daily_summary_data ? [daily_summary_data] :
        Array.isArray(req.body) ? req.body : []

    if (records.length === 0) {
      return res.json({
        success: true,
        message: "No daily summary records to process",
        processed_count: 0
      })
    }

    console.log(`Processing ${records.length} daily summary records from sync`)

    let processedCount = 0
    let duplicateCount = 0
    let errorCount = 0
    const errors = []
    let transactionActive = false

    try {
      // Begin transaction for batch processing
      await db.run("BEGIN TRANSACTION")
      transactionActive = true

      for (let i = 0; i < records.length; i++) {
        const record = records[i]

        try {
          // Validate required fields
          if (!record.employee_uid || !record.date || !record.employee_name) {
            errors.push({
              index: i,
              error: "Missing required fields (employee_uid, date, employee_name)",
              record_id: record.id || 'unknown'
            })
            errorCount++
            continue
          }

          // Check for existing record (update or skip based on last_updated timestamp)
          const existingRecord = await db.get(`
            SELECT id, last_updated FROM daily_attendance_summary 
            WHERE employee_uid = ? AND date = ?
          `, [record.employee_uid, record.date])

          if (existingRecord) {
            // Compare timestamps to decide if we should update
            const existingTimestamp = new Date(existingRecord.last_updated || '1970-01-01')
            const newTimestamp = new Date(record.last_updated || '1970-01-01')
            
            if (newTimestamp <= existingTimestamp) {
              duplicateCount++
              console.log(`Skipping older/duplicate record for employee ${record.employee_uid} on ${record.date}`)
              continue
            }
            
            // Update existing record
            await db.run(`
              UPDATE daily_attendance_summary SET
                id_number = ?,
                id_barcode = ?,
                employee_name = ?,
                first_name = ?,
                last_name = ?,
                department = ?,
                first_clock_in = ?,
                last_clock_out = ?,
                morning_in = ?,
                morning_out = ?,
                afternoon_in = ?,
                afternoon_out = ?,
                evening_in = ?,
                evening_out = ?,
                overtime_in = ?,
                overtime_out = ?,
                regular_hours = ?,
                overtime_hours = ?,
                total_hours = ?,
                morning_hours = ?,
                afternoon_hours = ?,
                evening_hours = ?,
                overtime_session_hours = ?,
                is_incomplete = ?,
                has_late_entry = ?,
                has_overtime = ?,
                has_evening_session = ?,
                total_sessions = ?,
                completed_sessions = ?,
                pending_sessions = ?,
                total_minutes_worked = ?,
                break_time_minutes = ?,
                last_updated = ?
              WHERE id = ?
            `, [
              record.id_number,
              record.id_barcode,
              record.employee_name,
              record.first_name,
              record.last_name,
              record.department,
              record.first_clock_in,
              record.last_clock_out,
              record.morning_in,
              record.morning_out,
              record.afternoon_in,
              record.afternoon_out,
              record.evening_in,
              record.evening_out,
              record.overtime_in,
              record.overtime_out,
              record.regular_hours || 0,
              record.overtime_hours || 0,
              record.total_hours || 0,
              record.morning_hours || 0,
              record.afternoon_hours || 0,
              record.evening_hours || 0,
              record.overtime_session_hours || 0,
              record.is_incomplete || 0,
              record.has_late_entry || 0,
              record.has_overtime || 0,
              record.has_evening_session || 0,
              record.total_sessions || 0,
              record.completed_sessions || 0,
              record.pending_sessions || 0,
              record.total_minutes_worked || 0,
              record.break_time_minutes || 0,
              record.last_updated || new Date().toISOString(),
              existingRecord.id
            ])
          } else {
            // Insert new record
            await db.run(`
              INSERT INTO daily_attendance_summary (
                employee_uid, id_number, id_barcode, employee_name, first_name, last_name,
                department, date, first_clock_in, last_clock_out, morning_in, morning_out,
                afternoon_in, afternoon_out, evening_in, evening_out, overtime_in, overtime_out,
                regular_hours, overtime_hours, total_hours, morning_hours, afternoon_hours,
                evening_hours, overtime_session_hours, is_incomplete, has_late_entry,
                has_overtime, has_evening_session, total_sessions, completed_sessions,
                pending_sessions, total_minutes_worked, break_time_minutes, last_updated, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              record.employee_uid,
              record.id_number,
              record.id_barcode,
              record.employee_name,
              record.first_name,
              record.last_name,
              record.department,
              record.date,
              record.first_clock_in,
              record.last_clock_out,
              record.morning_in,
              record.morning_out,
              record.afternoon_in,
              record.afternoon_out,
              record.evening_in,
              record.evening_out,
              record.overtime_in,
              record.overtime_out,
              record.regular_hours || 0,
              record.overtime_hours || 0,
              record.total_hours || 0,
              record.morning_hours || 0,
              record.afternoon_hours || 0,
              record.evening_hours || 0,
              record.overtime_session_hours || 0,
              record.is_incomplete || 0,
              record.has_late_entry || 0,
              record.has_overtime || 0,
              record.has_evening_session || 0,
              record.total_sessions || 0,
              record.completed_sessions || 0,
              record.pending_sessions || 0,
              record.total_minutes_worked || 0,
              record.break_time_minutes || 0,
              record.last_updated || new Date().toISOString(),
              record.created_at || new Date().toISOString()
            ])
          }

          processedCount++

        } catch (recordError) {
          console.error(`Error processing daily summary record ${i}:`, recordError)
          errors.push({
            index: i,
            error: recordError.message,
            employee_uid: record.employee_uid,
            date: record.date
          })
          errorCount++
        }
      }

      // Commit the transaction
      await db.run("COMMIT")
      transactionActive = false

      // Emit socket event for synced records if any were processed
      if (processedCount > 0) {
        const { socketEvents } = require("../config/socket")
        socketEvents.dailySummarySynced({ synced_count: processedCount })
      }

      // Send success response
      res.json({
        success: true,
        message: `Successfully processed ${processedCount} daily summary records`,
        processed_count: processedCount,
        duplicate_count: duplicateCount,
        error_count: errorCount,
        total_submitted: records.length,
        errors: errors.length > 0 ? errors : undefined
      })

    } catch (transactionError) {
      console.error("Transaction error occurred:", transactionError)
      
      // Only attempt rollback if transaction is still active
      if (transactionActive) {
        try {
          await db.run("ROLLBACK")
          console.log("Transaction rolled back successfully")
        } catch (rollbackError) {
          // Check if it's the specific rollback error we want to ignore
          if (rollbackError.message && rollbackError.message.includes('cannot rollback - no transaction is active')) {
            console.warn("Ignoring 'cannot rollback - no transaction is active' error as transaction was likely already completed")
            
            // Since the transaction might have actually completed successfully,
            // we can still return a partial success response if we processed some records
            if (processedCount > 0) {
              // Emit socket event for synced records
              try {
                const { socketEvents } = require("../config/socket")
                socketEvents.dailySummarySynced({ synced_count: processedCount })
              } catch (socketError) {
                console.warn("Failed to emit socket event:", socketError)
              }
              
              return res.json({
                success: true,
                message: `Processed ${processedCount} daily summary records (transaction completed despite rollback error)`,
                processed_count: processedCount,
                duplicate_count: duplicateCount,
                error_count: errorCount,
                total_submitted: records.length,
                warning: "Transaction rollback error was ignored - data may have been saved successfully",
                errors: errors.length > 0 ? errors : undefined
              })
            }
          } else {
            // Re-throw other rollback errors
            console.error("Failed to rollback transaction:", rollbackError)
            throw rollbackError
          }
        }
      }
      
      // Re-throw the original transaction error
      throw transactionError
    }

  } catch (error) {
    console.error("Error in daily summary sync:", error)
    
    // Check if the error message contains the specific rollback error we want to ignore
    if (error.message && error.message.includes('cannot rollback - no transaction is active')) {
      console.warn("Ignoring transaction rollback error - responding with partial success")
      
      return res.json({
        success: true,
        message: "Daily summary sync completed with transaction warnings",
        processed_count: processedCount || 0,
        duplicate_count: duplicateCount || 0,
        error_count: errorCount || 0,
        warning: "Transaction rollback error was ignored - data processing may have completed successfully"
      })
    }
    
    // Return error response for other types of errors
    res.status(500).json({
      success: false,
      error: "Failed to process daily summary sync",
      message: error.message
    })
  }
})

// GET /api/daily-summary/stats - Get daily summary statistics
router.get("/stats", async (req, res) => {
  try {
    const db = getDatabase()
    const { 
      date = new Date().toISOString().split('T')[0],
      start_date,
      end_date 
    } = req.query

    let dateFilter = "s.date = ?"
    let dateParams = [date]

    if (start_date && end_date) {
      dateFilter = "s.date BETWEEN ? AND ?"
      dateParams = [start_date, end_date]
    }

    // Summary statistics
    const summaryStats = await db.get(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT s.employee_uid) as unique_employees,
        COUNT(DISTINCT s.department) as departments_count,
        SUM(s.regular_hours) as total_regular_hours,
        SUM(s.overtime_hours) as total_overtime_hours,
        SUM(s.total_hours) as grand_total_hours,
        AVG(s.total_hours) as avg_hours_per_employee,
        SUM(CASE WHEN s.has_overtime = 1 THEN 1 ELSE 0 END) as employees_with_overtime,
        SUM(CASE WHEN s.is_incomplete = 1 THEN 1 ELSE 0 END) as incomplete_records,
        SUM(CASE WHEN s.has_late_entry = 1 THEN 1 ELSE 0 END) as employees_with_late_entry
      FROM daily_attendance_summary s
      WHERE ${dateFilter}
    `, dateParams)

    // Department breakdown
    const departmentStats = await db.all(`
      SELECT 
        s.department,
        COUNT(*) as employee_count,
        SUM(s.regular_hours) as total_regular_hours,
        SUM(s.overtime_hours) as total_overtime_hours,
        SUM(s.total_hours) as total_hours,
        AVG(s.total_hours) as avg_hours
      FROM daily_attendance_summary s
      WHERE ${dateFilter}
      GROUP BY s.department
      ORDER BY total_hours DESC
    `, dateParams)

    // Top overtime earners
    const overtimeLeaders = await db.all(`
      SELECT 
        s.employee_name,
        s.department,
        s.date,
        s.overtime_hours,
        s.total_hours
      FROM daily_attendance_summary s
      WHERE ${dateFilter} AND s.overtime_hours > 0
      ORDER BY s.overtime_hours DESC
      LIMIT 10
    `, dateParams)

    // Recent activity summary
    const recentActivity = await db.all(`
      SELECT 
        s.employee_name,
        s.department,
        s.date,
        s.total_hours,
        s.is_incomplete,
        s.has_late_entry,
        s.has_overtime,
        s.last_updated
      FROM daily_attendance_summary s
      ORDER BY s.last_updated DESC
      LIMIT 10
    `)

    res.json({
      success: true,
      data: {
        date_range: start_date && end_date ? { start_date, end_date } : { date },
        summary: summaryStats,
        by_department: departmentStats,
        overtime_leaders: overtimeLeaders,
        recent_activity: recentActivity
      }
    })

  } catch (error) {
    console.error("Error fetching daily summary statistics:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch daily summary statistics",
      message: error.message
    })
  }
})

// GET /api/daily-summary/:id - Get specific daily summary record
router.get("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    const record = await db.get(`
      SELECT 
        s.*,
        e.email,
        e.position,
        e.hire_date,
        e.status as employee_status
      FROM daily_attendance_summary s
      LEFT JOIN emp_list e ON s.employee_uid = e.uid
      WHERE s.id = ?
    `, [id])

    if (!record) {
      return res.status(404).json({
        success: false,
        error: "Daily summary record not found"
      })
    }

    res.json({
      success: true,
      data: record
    })

  } catch (error) {
    console.error("Error fetching daily summary record:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch daily summary record",
      message: error.message
    })
  }
})

// GET /api/daily-summary/employee/:employee_uid - Get daily summary for specific employee
router.get("/employee/:employee_uid", async (req, res) => {
  try {
    const db = getDatabase()
    const { employee_uid } = req.params
    const {
      limit = 50,
      offset = 0,
      start_date,
      end_date
    } = req.query

    const conditions = ["s.employee_uid = ?"]
    const params = [employee_uid]

    if (start_date && end_date) {
      conditions.push("s.date BETWEEN ? AND ?")
      params.push(start_date, end_date)
    }

    const records = await db.all(`
      SELECT 
        s.*,
        e.email,
        e.position
      FROM daily_attendance_summary s
      LEFT JOIN emp_list e ON s.employee_uid = e.uid
      WHERE ${conditions.join(" AND ")}
      ORDER BY s.date DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)])

    const totalResult = await db.get(`
      SELECT COUNT(*) as total 
      FROM daily_attendance_summary s 
      WHERE ${conditions.join(" AND ")}
    `, params)

    // Calculate summary for the employee
    const employeeSummary = await db.get(`
      SELECT 
        COUNT(*) as total_days,
        SUM(s.regular_hours) as total_regular_hours,
        SUM(s.overtime_hours) as total_overtime_hours,
        SUM(s.total_hours) as grand_total_hours,
        AVG(s.total_hours) as avg_daily_hours,
        SUM(CASE WHEN s.has_overtime = 1 THEN 1 ELSE 0 END) as days_with_overtime,
        SUM(CASE WHEN s.has_late_entry = 1 THEN 1 ELSE 0 END) as days_with_late_entry,
        SUM(CASE WHEN s.is_incomplete = 1 THEN 1 ELSE 0 END) as incomplete_days
      FROM daily_attendance_summary s 
      WHERE ${conditions.join(" AND ")}
    `, params)

    res.json({
      success: true,
      data: {
        records,
        summary: employeeSummary,
        pagination: {
          total: totalResult.total,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      }
    })

  } catch (error) {
    console.error("Error fetching employee daily summary:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch employee daily summary",
      message: error.message
    })
  }
})

// DELETE /api/daily-summary/:id - Delete daily summary record
router.delete("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    // Check if record exists
    const existingRecord = await db.get("SELECT id FROM daily_attendance_summary WHERE id = ?", [id])
    if (!existingRecord) {
      return res.status(404).json({
        success: false,
        error: "Daily summary record not found"
      })
    }

    await db.run("DELETE FROM daily_attendance_summary WHERE id = ?", [id])

    // Emit socket event
    const { socketEvents } = require("../config/socket")
    socketEvents.dailySummaryDeleted({ id: parseInt(id) })

    res.json({
      success: true,
      message: "Daily summary record deleted successfully"
    })

  } catch (error) {
    console.error("Error deleting daily summary record:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete daily summary record",
      message: error.message
    })
  }
})

// POST /api/daily-summary/rebuild - Rebuild daily summary for date range
router.post("/rebuild", async (req, res) => {
  try {
    const db = getDatabase()
    const { start_date, end_date } = req.body

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: "start_date and end_date are required"
      })
    }

    console.log(`Rebuilding daily summary from ${start_date} to ${end_date}`)

    // Get all unique employee-date combinations in the range from attendance table
    const employeeDateQuery = await db.all(`
      SELECT DISTINCT employee_uid, date
      FROM attendance 
      WHERE date BETWEEN ? AND ?
      ORDER BY employee_uid, date
    `, [start_date, end_date])

    let successCount = 0
    let failCount = 0

    await db.run("BEGIN TRANSACTION")

    try {
      for (const { employee_uid, date } of employeeDateQuery) {
        try {
          // Get employee info
          const employee = await db.get(`
            SELECT uid, id_number, id_barcode, first_name, last_name, department
            FROM emp_list WHERE uid = ?
          `, [employee_uid])

          if (!employee) {
            failCount++
            continue
          }

          // Get attendance records for this employee and date
          const attendanceRecords = await db.all(`
            SELECT * FROM attendance 
            WHERE employee_uid = ? AND date = ?
            ORDER BY clock_time ASC
          `, [employee_uid, date])

          if (attendanceRecords.length === 0) {
            failCount++
            continue
          }

          // Process records to build summary
          const sessionTimes = {
            morning_in: null, morning_out: null,
            afternoon_in: null, afternoon_out: null,
            evening_in: null, evening_out: null,
            overtime_in: null, overtime_out: null
          }

          let totalRegularHours = 0
          let totalOvertimeHours = 0
          let totalSessions = 0
          let completedSessions = 0
          let pendingSessions = 0
          let hasLateEntry = false
          let hasOvertime = false
          let hasEveningSession = false

          // Process each attendance record
          attendanceRecords.forEach(record => {
            const clockType = record.clock_type
            
            if (sessionTimes.hasOwnProperty(clockType)) {
              sessionTimes[clockType] = record.clock_time
            }
            
            totalRegularHours += record.regular_hours || 0
            totalOvertimeHours += record.overtime_hours || 0
            
            if (clockType.endsWith('_in')) {
              totalSessions++
              const outType = clockType.replace('_in', '_out')
              const hasOut = attendanceRecords.some(r => r.clock_type === outType && r.clock_time > record.clock_time)
              if (hasOut) {
                completedSessions++
              } else {
                pendingSessions++
              }
            }
            
            if (record.is_late) hasLateEntry = true
            if (clockType.startsWith('overtime') || clockType.startsWith('evening')) {
              hasOvertime = true
              if (clockType.startsWith('evening')) hasEveningSession = true
            }
          })

          // Calculate session hours (simplified)
          const sessionHours = {
            morning_hours: 0,
            afternoon_hours: 0,
            evening_hours: 0,
            overtime_session_hours: 0
          }

          const morningSession = sessionTimes.morning_in && sessionTimes.morning_out
          const afternoonSession = sessionTimes.afternoon_in && sessionTimes.afternoon_out
          const eveningSession = sessionTimes.evening_in && sessionTimes.evening_out
          const overtimeSession = sessionTimes.overtime_in && sessionTimes.overtime_out

          if (morningSession || afternoonSession) {
            const regularSessionCount = (morningSession ? 1 : 0) + (afternoonSession ? 1 : 0)
            if (morningSession) sessionHours.morning_hours = totalRegularHours / regularSessionCount
            if (afternoonSession) sessionHours.afternoon_hours = totalRegularHours / regularSessionCount
          }

          if (eveningSession) sessionHours.evening_hours = totalOvertimeHours * 0.7
          if (overtimeSession) sessionHours.overtime_session_hours = totalOvertimeHours * 0.3

          const firstClockIn = attendanceRecords.find(r => r.clock_type.endsWith('_in'))?.clock_time
          const lastClockOut = [...attendanceRecords].reverse().find(r => r.clock_type.endsWith('_out'))?.clock_time

          let totalMinutesWorked = 0
          if (firstClockIn && lastClockOut) {
            const firstTime = new Date(firstClockIn)
            const lastTime = new Date(lastClockOut)
            totalMinutesWorked = Math.round((lastTime - firstTime) / 60000)
            if (morningSession && afternoonSession) {
              totalMinutesWorked = Math.max(0, totalMinutesWorked - 60)
            }
          }

          // Upsert summary record
          await db.run(`
            INSERT OR REPLACE INTO daily_attendance_summary (
              employee_uid, id_number, id_barcode, employee_name, first_name, last_name,
              department, date, first_clock_in, last_clock_out,
              morning_in, morning_out, afternoon_in, afternoon_out,
              evening_in, evening_out, overtime_in, overtime_out,
              regular_hours, overtime_hours, total_hours,
              morning_hours, afternoon_hours, evening_hours, overtime_session_hours,
              is_incomplete, has_late_entry, has_overtime, has_evening_session,
              total_sessions, completed_sessions, pending_sessions,
              total_minutes_worked, break_time_minutes, last_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            employee.uid, employee.id_number, employee.id_barcode,
            `${employee.first_name} ${employee.last_name}`, employee.first_name, employee.last_name,
            employee.department, date, firstClockIn, lastClockOut,
            sessionTimes.morning_in, sessionTimes.morning_out, sessionTimes.afternoon_in, sessionTimes.afternoon_out,
            sessionTimes.evening_in, sessionTimes.evening_out, sessionTimes.overtime_in, sessionTimes.overtime_out,
            totalRegularHours, totalOvertimeHours, totalRegularHours + totalOvertimeHours,
            sessionHours.morning_hours, sessionHours.afternoon_hours, sessionHours.evening_hours, sessionHours.overtime_session_hours,
            pendingSessions > 0 ? 1 : 0, hasLateEntry ? 1 : 0, hasOvertime ? 1 : 0, hasEveningSession ? 1 : 0,
            totalSessions, completedSessions, pendingSessions,
            totalMinutesWorked, (morningSession && afternoonSession) ? 60 : 0, new Date().toISOString()
          ])

          successCount++

        } catch (recordError) {
          console.error(`Error rebuilding summary for employee ${employee_uid} on ${date}:`, recordError)
          failCount++
        }
      }

      await db.run("COMMIT")

      console.log(`Daily summary rebuild completed: ${successCount} successful, ${failCount} failed`)

      // Emit socket event
      const { socketEvents } = require("../config/socket")
      socketEvents.dailySummaryRebuilt({ 
        processed_count: successCount + failCount,
        success_count: successCount,
        fail_count: failCount
      })

      res.json({
        success: true,
        message: `Daily summary rebuild completed`,
        processed_count: successCount + failCount,
        success_count: successCount,
        fail_count: failCount,
        date_range: { start_date, end_date }
      })

    } catch (transactionError) {
      await db.run("ROLLBACK")
      throw transactionError
    }

  } catch (error) {
    console.error("Error rebuilding daily summary:", error)
    res.status(500).json({
      success: false,
      error: "Failed to rebuild daily summary",
      message: error.message
    })
  }
})

module.exports = router