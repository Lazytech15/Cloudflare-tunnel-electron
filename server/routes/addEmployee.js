//addEmployee.js
const express = require("express")
const bcrypt = require("bcrypt")
const { getDatabase } = require("../config/database")

const router = express.Router()

// Add new employee
router.post("/", async (req, res) => {
  try {
    const db = getDatabase()
    const {
      last_name,
      first_name,
      middle_name,
      username,
      access_level,
      password,
      department,
      action,
      philhealth_number,
      age,
      birth_date,
      contact_number,
      email,
      civil_status,
      address,
      hire_date,
      position,
      status = "Active",
      salary,
      id_number,
      id_barcode,
      tin_number,
      sss_number,
      pagibig_number,
      profile_picture,
      document
    } = req.body

    // Validation
    if (!first_name || !last_name) {
      return res.status(400).json({
        success: false,
        error: "First name and last name are required"
      })
    }

    if (!username) {
      return res.status(400).json({
        success: false,
        error: "Username is required"
      })
    }

    // Check if username already exists
    const existingUser = await db.get(
      "SELECT uid FROM emp_list WHERE username = ?",
      [username]
    )

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "Username already exists"
      })
    }

    // Check if id_number already exists (if provided)
    if (id_number) {
      const existingIdNumber = await db.get(
        "SELECT uid FROM emp_list WHERE id_number = ?",
        [id_number]
      )

      if (existingIdNumber) {
        return res.status(400).json({
          success: false,
          error: "ID number already exists"
        })
      }
    }

    // Hash password if provided
    let password_salt = null
    let password_hash = null
    if (password) {
      const saltRounds = 12
      password_salt = await bcrypt.genSalt(saltRounds)
      password_hash = await bcrypt.hash(password, password_salt)
    }

    // Generate TFA salt and hash (optional - can be set later)
    let tfa_salt = null
    let tfa_hash = null

    const currentTimestamp = new Date().toISOString()

    // Insert new employee
    const result = await db.run(`
      INSERT INTO emp_list (
        last_name,
        first_name,
        middle_name,
        username,
        access_level,
        password_salt,
        password_hash,
        tfa_salt,
        tfa_hash,
        department,
        action,
        created_at,
        philhealth_number,
        age,
        birth_date,
        contact_number,
        email,
        civil_status,
        address,
        hire_date,
        position,
        status,
        salary,
        id_number,
        id_barcode,
        tin_number,
        sss_number,
        pagibig_number,
        updated_at,
        profile_picture,
        document
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      last_name,
      first_name,
      middle_name,
      username,
      access_level,
      password_salt,
      password_hash,
      tfa_salt,
      tfa_hash,
      department,
      action,
      currentTimestamp,
      philhealth_number,
      age,
      birth_date,
      contact_number,
      email,
      civil_status,
      address,
      hire_date,
      position,
      status,
      salary,
      id_number,
      id_barcode,
      tin_number,
      sss_number,
      pagibig_number,
      currentTimestamp,
      profile_picture,
      document
    ])

    // Get the created employee (without sensitive data)
    const newEmployee = await db.get(`
      SELECT 
        uid,
        last_name,
        first_name,
        middle_name,
        username,
        access_level,
        department,
        action,
        created_at,
        philhealth_number,
        age,
        birth_date,
        contact_number,
        email,
        civil_status,
        address,
        hire_date,
        position,
        status,
        salary,
        id_number,
        id_barcode,
        tin_number,
        sss_number,
        pagibig_number,
        updated_at
      FROM emp_list 
      WHERE uid = ?
    `, [result.lastID])

    res.status(201).json({
      success: true,
      message: "Employee added successfully",
      data: newEmployee
    })

  } catch (error) {
    console.error("Error adding employee:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    })
  }
})

// Get all employees
router.get("/", async (req, res) => {
  try {
    const db = getDatabase()
    const { limit = 50, offset = 0, status, department } = req.query

    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 50), 100)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    let whereClause = "WHERE 1=1"
    let params = []

    if (status) {
      whereClause += " AND status = ?"
      params.push(status)
    }

    if (department) {
      whereClause += " AND department = ?"
      params.push(department)
    }

    const employees = await db.all(`
      SELECT 
        uid,
        last_name,
        first_name,
        middle_name,
        username,
        access_level,
        department,
        action,
        created_at,
        philhealth_number,
        age,
        birth_date,
        contact_number,
        email,
        civil_status,
        address,
        hire_date,
        position,
        status,
        salary,
        id_number,
        id_barcode,
        tin_number,
        sss_number,
        pagibig_number,
        updated_at
      FROM emp_list 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, [...params, parsedLimit, parsedOffset])

    const total = await db.get(`
      SELECT COUNT(*) as count 
      FROM emp_list 
      ${whereClause}
    `, params)

    res.json({
      success: true,
      data: employees,
      total: total.count,
      limit: parsedLimit,
      offset: parsedOffset
    })

  } catch (error) {
    console.error("Error fetching employees:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    })
  }
})

// Get employee by ID
router.get("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    const employee = await db.get(`
      SELECT 
        uid,
        last_name,
        first_name,
        middle_name,
        username,
        access_level,
        department,
        action,
        created_at,
        philhealth_number,
        age,
        birth_date,
        contact_number,
        email,
        civil_status,
        address,
        hire_date,
        position,
        status,
        salary,
        id_number,
        id_barcode,
        tin_number,
        sss_number,
        pagibig_number,
        updated_at
      FROM emp_list 
      WHERE uid = ?
    `, [id])

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    res.json({
      success: true,
      data: employee
    })

  } catch (error) {
    console.error("Error fetching employee:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    })
  }
})

// Update employee
router.put("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params
    const updateData = req.body

    // Remove sensitive fields that shouldn't be updated via this route
    delete updateData.password_salt
    delete updateData.password_hash
    delete updateData.tfa_salt
    delete updateData.tfa_hash
    delete updateData.uid
    delete updateData.created_at

    // Check if employee exists
    const existingEmployee = await db.get("SELECT uid FROM emp_list WHERE uid = ?", [id])
    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    // If username is being updated, check for duplicates
    if (updateData.username) {
      const existingUsername = await db.get(
        "SELECT uid FROM emp_list WHERE username = ? AND uid != ?",
        [updateData.username, id]
      )
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          error: "Username already exists"
        })
      }
    }

    // If id_number is being updated, check for duplicates
    if (updateData.id_number) {
      const existingIdNumber = await db.get(
        "SELECT uid FROM emp_list WHERE id_number = ? AND uid != ?",
        [updateData.id_number, id]
      )
      if (existingIdNumber) {
        return res.status(400).json({
          success: false,
          error: "ID number already exists"
        })
      }
    }

    // Build dynamic update query
    const fields = Object.keys(updateData)
    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields to update"
      })
    }

    const setClause = fields.map(field => `${field} = ?`).join(", ")
    const values = fields.map(field => updateData[field])
    values.push(new Date().toISOString()) // updated_at
    values.push(id) // WHERE condition

    await db.run(`
      UPDATE emp_list 
      SET ${setClause}, updated_at = ?
      WHERE uid = ?
    `, values)

    // Get updated employee
    const updatedEmployee = await db.get(`
      SELECT 
        uid,
        last_name,
        first_name,
        middle_name,
        username,
        access_level,
        department,
        action,
        created_at,
        philhealth_number,
        age,
        birth_date,
        contact_number,
        email,
        civil_status,
        address,
        hire_date,
        position,
        status,
        salary,
        id_number,
        id_barcode,
        tin_number,
        sss_number,
        pagibig_number,
        updated_at
      FROM emp_list 
      WHERE uid = ?
    `, [id])

    res.json({
      success: true,
      message: "Employee updated successfully",
      data: updatedEmployee
    })

  } catch (error) {
    console.error("Error updating employee:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    })
  }
})

// Delete employee (soft delete by setting status to 'Inactive')
router.delete("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    // Check if employee exists
    const existingEmployee = await db.get("SELECT uid, status FROM emp_list WHERE uid = ?", [id])
    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    // Soft delete by setting status to 'Inactive'
    await db.run(`
      UPDATE emp_list 
      SET status = 'Inactive', updated_at = ?
      WHERE uid = ?
    `, [new Date().toISOString(), id])

    res.json({
      success: true,
      message: "Employee deactivated successfully"
    })

  } catch (error) {
    console.error("Error deleting employee:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    })
  }
})

module.exports = router