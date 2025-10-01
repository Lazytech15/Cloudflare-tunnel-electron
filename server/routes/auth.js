// server/routes/auth.js
const express = require("express")
const { getDatabase } = require("../config/database")
const { getUserRoleAndPermissions } = require("../middleware/auth")
const { socketEvents } = require("../config/socket")
const bcrypt = require("bcrypt")

const router = express.Router()

// Authentication endpoint
router.get("/auth", async (req, res) => {
  try {
    const db = getDatabase()
    const { username, password, department } = req.query

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      })
    }

    if (!department) {
      return res.status(400).json({
        success: false,
        error: "Department is required",
      })
    }

    // Define valid departments
    const validDepartments = ["Human Resources", "Operation", "Finance", "Procurement", "Engineering", "super-admin"]

    if (!validDepartments.includes(department)) {
      return res.status(400).json({
        success: false,
        error: "Invalid department",
      })
    }

    // Fetch user by username and department
    let query = `SELECT * FROM emp_list WHERE username = ?`
    const params = [username]

    // If not super-admin, also check department
    if (department !== "super-admin") {
      query += ` AND department = ?`
      params.push(department)
    }

    const user = await db.get(query, params)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found or not authorized for this department",
      })
    }

    // Compare hashed password
    const match = await bcrypt.compare(password, user.password_hash)

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      })
    }

    // Determine user role and permissions
    const { role, permissions } = getUserRoleAndPermissions(user, department)

    // Return success response with user info (excluding sensitive fields)
    const { uid, first_name, last_name, access_level, department: userDept } = user

    const userData = {
      id: uid,
      name: `${first_name} ${last_name}`.trim(),
      username: username,
      access_level: access_level,
      department: userDept,
      role: role,
      permissions: permissions,
    }

    socketEvents.userLoggedIn({
      id: uid,
      username: username,
      role: role,
    })

    res.json({
      success: true,
      user: userData,
    })
  } catch (error) {
    console.error("Auth error:", error)
    res.status(500).json({
      success: false,
      error: "Authentication failed",
    })
  }
})

module.exports = router
