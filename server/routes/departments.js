const express = require("express")
const { getDatabase } = require("../config/database")

const router = express.Router()

// Get all departments with employee counts
router.get("/", async (req, res) => {
  try {
    const db = getDatabase()

    const departments = await db.all(`
      SELECT 
        COALESCE(department, 'Unassigned') as name,
        COUNT(*) as employee_count,
        COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_count
      FROM emp_list 
      WHERE department IS NOT NULL AND department != ''
      GROUP BY department 
      ORDER BY employee_count DESC
    `)

    // Add predefined departments that might not have employees yet
    const predefinedDepts = [
      "Human Resources",
      "Engineering",
      "Finance",
      "Marketing",
      "Information Technology",
      "Operations",
      "Procurement",
    ]

    const existingDeptNames = departments.map((d) => d.name)
    predefinedDepts.forEach((dept) => {
      if (!existingDeptNames.includes(dept)) {
        departments.push({
          name: dept,
          employee_count: 0,
          active_count: 0,
        })
      }
    })

    res.json({
      success: true,
      data: departments,
    })
  } catch (error) {
    console.error("Error fetching departments:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch departments",
      message: error.message,
    })
  }
})

module.exports = router
