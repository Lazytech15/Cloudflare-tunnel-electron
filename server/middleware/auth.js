const bcrypt = require("bcrypt")
const { getDatabase } = require("../config/database")

// Authentication middleware
async function authenticateUser(req, res, next) {
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

    // Add user info to request
    req.user = user
    req.department = department
    next()
  } catch (error) {
    console.error("Auth middleware error:", error)
    res.status(500).json({
      success: false,
      error: "Authentication failed",
    })
  }
}

// Helper function to determine user role and permissions
function getUserRoleAndPermissions(user, department) {
  let role = "user"
  let permissions = ["read"]

  if (department === "super-admin" && user.access_level >= 10) {
    role = "super-admin"
    permissions = ["read", "write", "delete", "admin", "manage-all"]
  } else if (user.access_level >= 8) {
    role = "admin"
    permissions = ["read", "write", "delete", "admin"]
  } else if (user.access_level >= 5) {
    role = "manager"
    permissions = ["read", "write", "delete"]
  } else if (user.access_level >= 3) {
    role = "editor"
    permissions = ["read", "write"]
  }

  return { role, permissions }
}

module.exports = {
  authenticateUser,
  getUserRoleAndPermissions,
}
