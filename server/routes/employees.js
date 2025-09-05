//get employees.js
const express = require("express")
const { getDatabase } = require("../config/database")
const { socketEvents } = require("../config/socket")
const fs = require('fs');
const path = require('path');

const router = express.Router()

// Get all employees with filtering and pagination
router.get("/", async (req, res) => {
  try {
    const db = getDatabase()
    const {
      limit = 100,
      offset = 0,
      search = "",
      department = "",
      status = "Active",
      sortBy = "hire_date",
      sortOrder = "DESC",
    } = req.query

    // Validate and sanitize parameters
    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 100), 1000)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    // Validate sort parameters
    const allowedSortFields = ["last_name", "first_name", "hire_date", "position", "salary", "age"]
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : "hire_date"
    const validSortOrder = ["ASC", "DESC"].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : "DESC"

    // Build WHERE clause
    const whereConditions = []
    const params = []

    // Search functionality
    if (search) {
      whereConditions.push(`(
        LOWER(first_name || ' ' || COALESCE(middle_name, '') || ' ' || last_name) LIKE LOWER(?) OR
        LOWER(position) LIKE LOWER(?) OR
        LOWER(department) LIKE LOWER(?) OR
        LOWER(email) LIKE LOWER(?)
      )`)
      const searchTerm = `%${search}%`
      params.push(searchTerm, searchTerm, searchTerm, searchTerm)
    }

    // Filter by department
    if (department) {
      whereConditions.push("LOWER(department) = LOWER(?)")
      params.push(department)
    }

    // Filter by status
    if (status) {
      whereConditions.push("LOWER(status) = LOWER(?)")
      params.push(status)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // Main query to fetch employee data
    const employeeQuery = `
      SELECT 
        uid as id,
        (first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name) as full_name,
        first_name,
        middle_name,
        last_name,
        age,
        birth_date,
        contact_number,
        email,
        civil_status,
        address,
        hire_date,
        position,
        department,
        id_number,
        id_barcode,
        tin_number,
        sss_number,
        pagibig_number,
        philhealth_number,
        status,
        salary,
        profile_picture,
        document,
        created_at,
        CASE 
          WHEN hire_date >= date('now', '-30 days') THEN 1 
          ELSE 0 
        END as is_new_hire
      FROM emp_list
      ${whereClause}
      ORDER BY ${validSortBy} ${validSortOrder}
      LIMIT ? OFFSET ?
    `

    const employees = await db.all(employeeQuery, [...params, parsedLimit, parsedOffset])

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM emp_list
      ${whereClause}
    `
    const totalResult = await db.get(countQuery, params)

    // Get departments with count
    const departmentsQuery = `
      SELECT 
        department as name,
        COUNT(*) as totalCount
      FROM emp_list
      WHERE department IS NOT NULL AND department != ''
      GROUP BY department
      ORDER BY department
    `
    const departments = await db.all(departmentsQuery)

    // Get statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_employees,
        COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_employees,
        COUNT(CASE WHEN status = 'Inactive' THEN 1 END) as inactive_employees,
        COUNT(CASE WHEN hire_date >= date('now', '-30 days') THEN 1 END) as new_hires_last_30_days,
        COUNT(CASE WHEN department IS NULL OR department = '' THEN 1 END) as employees_without_department,
        AVG(CASE WHEN salary IS NOT NULL AND salary != '' THEN CAST(REPLACE(REPLACE(salary, '₱', ''), ',', '') AS DECIMAL) END) as average_salary,
        COUNT(DISTINCT department) as total_departments
      FROM emp_list
      ${whereClause}
    `
    const stats = await db.get(statsQuery, params)

    // Format the response
    const formattedEmployees = employees.map((emp) => ({
      id: emp.id,
      fullName: emp.full_name,
      firstName: emp.first_name,
      middleName: emp.middle_name,
      lastName: emp.last_name,
      age: emp.age,
      birthDate: emp.birth_date,
      contactNumber: emp.contact_number,
      email: emp.email,
      civilStatus: emp.civil_status,
      address: emp.address,
      hireDate: emp.hire_date,
      position: emp.position,
      department: emp.department,
      idNumber: emp.id_number,
      idBarcode: emp.id_barcode,
      tinNumber: emp.tin_number,
      sssNumber: emp.sss_number,
      pagibigNumber: emp.pagibig_number,
      philhealthNumber: emp.philhealth_number,
      status: emp.status,
      salary: emp.salary,
      profilePicture: emp.profile_picture, // Fixed: Include profile_picture
      document: emp.document, // Fixed: Include document
      createdAt: emp.created_at,
      isNewHire: emp.is_new_hire === 1,
    }))

    res.json({
      success: true,
      data: {
        employees: formattedEmployees,
        departments: departments, // Fixed: Include departments in response
        pagination: {
          total: totalResult.total,
          limit: parsedLimit,
          offset: parsedOffset,
          pages: Math.ceil(totalResult.total / parsedLimit),
          currentPage: Math.floor(parsedOffset / parsedLimit) + 1,
        },
        statistics: {
          totalEmployees: stats.total_employees,
          activeEmployees: stats.active_employees,
          inactiveEmployees: stats.inactive_employees,
          newHiresLast30Days: stats.new_hires_last_30_days,
          employeesWithoutDepartment: stats.employees_without_department,
          averageSalary: stats.average_salary ? `₱${Number(stats.average_salary).toLocaleString()}` : null,
          totalDepartments: stats.total_departments,
        },
      },
    })
  } catch (error) {
    console.error("Error fetching employees:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch employees",
      message: error.message,
    })
  }
})

// Get single employee by ID
router.get("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    const employee = await db.get(
      `
      SELECT 
        uid as id,
        (first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name) as full_name,
        first_name,
        middle_name,
        last_name,
        age,
        birth_date,
        contact_number,
        email,
        civil_status,
        address,
        hire_date,
        position,
        department,
        id_number,
        id_barcode,
        tin_number,
        sss_number,
        pagibig_number,
        philhealth_number,
        status,
        salary,
        profile_picture,
        document,
        created_at
      FROM emp_list
      WHERE uid = ?
    `,
      [id],
    )

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found",
      })
    }

    const formattedEmployee = {
      id: employee.id,
      fullName: employee.full_name,
      firstName: employee.first_name,
      middleName: employee.middle_name,
      lastName: employee.last_name,
      age: employee.age,
      birthDate: employee.birth_date,
      contactNumber: employee.contact_number,
      email: employee.email,
      civilStatus: employee.civil_status,
      address: employee.address,
      hireDate: employee.hire_date,
      position: employee.position,
      department: employee.department,
      idNumber: employee.id_number,
      idBarcode: employee.id_barcode,
      tinNumber: employee.tin_number,
      sssNumber: employee.sss_number,
      pagibigNumber: employee.pagibig_number,
      philhealthNumber: employee.philhealth_number,
      status: employee.status,
      salary: employee.salary,
      profilePicture: employee.profile_picture, // Fixed: Include profile_picture
      document: employee.document, // Fixed: Include document
      createdAt: employee.created_at,
    }

    res.json({
      success: true,
      data: formattedEmployee,
    })
  } catch (error) {
    console.error("Error fetching employee:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch employee",
      message: error.message,
    })
  }
})

// Create new employee
router.post("/", async (req, res) => {
  try {
    const db = getDatabase()
    const {
      firstName,
      middleName,
      lastName,
      age,
      birthDate,
      contactNumber,
      email,
      civilStatus,
      address,
      position,
      department,
      salary,
      hireDate,
      status = "Active",
      employeeId,
      idBarcode,
      tinNumber,
      sssNumber,
      pagibigNumber,
      philhealthNumber,
      profilePicture,
      document,
      username,
      accessLevel = "user",
    } = req.body

    console.log("Adding new employee:", { firstName, lastName, position, department, employeeId, idBarcode })

    // Validation - required fields
    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: "First name and last name are required",
      })
    }

    if (!email || !position || !department) {
      return res.status(400).json({
        success: false,
        error: "Email, position, and department are required",
      })
    }

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        error: "Employee ID is required",
      })
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid email address",
      })
    }

    // Check if email already exists
    const existingEmployee = await db.get("SELECT uid, email FROM emp_list WHERE LOWER(email) = LOWER(?)", [email])

    if (existingEmployee) {
      return res.status(400).json({
        success: false,
        error: "An employee with this email address already exists",
      })
    }

    // Check if employee ID already exists
    const existingEmployeeId = await db.get("SELECT uid, id_number FROM emp_list WHERE id_number = ?", [employeeId])

    if (existingEmployeeId) {
      return res.status(400).json({
        success: false,
        error: "An employee with this ID already exists",
      })
    }

    // Generate username if not provided
    const generatedUsername = username || `${firstName.toLowerCase()}${lastName.toLowerCase()}`.replace(/\s/g, "")

    // Insert new employee
    const insertQuery = `
      INSERT INTO emp_list (
        first_name, middle_name, last_name, age, birth_date, contact_number, email,
        civil_status, address, hire_date, position, department, status, id_number, id_barcode, salary,
        tin_number, sss_number, pagibig_number, philhealth_number,
        profile_picture, document, username, access_level, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const result = await db.run(insertQuery, [
      firstName,
      middleName || null,
      lastName,
      age || null,
      birthDate || null,
      contactNumber || null,
      email,
      civilStatus || null,
      address || null,
      hireDate || new Date().toISOString().split("T")[0],
      position,
      department,
      status,
      employeeId,
      idBarcode || null,
      salary || null,
      tinNumber || null,
      sssNumber || null,
      pagibigNumber || null,
      philhealthNumber || null,
      profilePicture || null, // Fixed: Include profile_picture
      document || null, // Fixed: Include document
      generatedUsername,
      accessLevel,
      new Date().toISOString(),
    ])

    if (result.changes > 0) {
      // Fetch the newly created employee
      const newEmployee = await db.get(
        `
        SELECT 
          uid as id,
          (first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name) as full_name,
          first_name, middle_name, last_name, age, birth_date, contact_number, email,
          civil_status, address, hire_date, position, department, status, id_number, id_barcode, salary,
          tin_number, sss_number, pagibig_number, philhealth_number,
          profile_picture, document, username, access_level, created_at
        FROM emp_list 
        WHERE uid = ?
      `,
        [result.lastID],
      )

      const employeeData = {
        id: newEmployee.id,
        fullName: newEmployee.full_name,
        firstName: newEmployee.first_name,
        middleName: newEmployee.middle_name,
        lastName: newEmployee.last_name,
        age: newEmployee.age,
        birthDate: newEmployee.birth_date,
        contactNumber: newEmployee.contact_number,
        email: newEmployee.email,
        civilStatus: newEmployee.civil_status,
        address: newEmployee.address,
        hireDate: newEmployee.hire_date,
        position: newEmployee.position,
        department: newEmployee.department,
        status: newEmployee.status,
        employeeId: newEmployee.id_number,
        idBarcode: newEmployee.id_barcode,
        salary: newEmployee.salary,
        tinNumber: newEmployee.tin_number,
        sssNumber: newEmployee.sss_number,
        pagibigNumber: newEmployee.pagibig_number,
        philhealthNumber: newEmployee.philhealth_number,
        profilePicture: newEmployee.profile_picture, // Fixed: Include profile_picture
        document: newEmployee.document, // Fixed: Include document
        username: newEmployee.username,
        accessLevel: newEmployee.access_level,
        createdAt: newEmployee.created_at,
      }

      console.log(
        `Successfully added employee: ${newEmployee.full_name} (ID: ${result.lastID}, Employee ID: ${newEmployee.id_number})`,
      )

      socketEvents.employeeCreated(employeeData)

      res.status(201).json({
        success: true,
        message: `Employee ${newEmployee.full_name} has been added successfully`,
        data: employeeData,
      })
    } else {
      throw new Error("Failed to insert employee record")
    }
  } catch (error) {
    console.error("Error adding employee:", error)
    res.status(500).json({
      success: false,
      error: "Failed to add employee",
      message: error.message,
    })
  }
})

// Update employee status
router.patch("/:id/status", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params
    const { status } = req.body

    // Validate status
    const validStatuses = ["Active", "Inactive", "On Leave", "Terminated"]
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(", "),
      })
    }

    // Check if employee exists
    const existingEmployee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [id])
    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found",
      })
    }

    // Update employee status
    const result = await db.run("UPDATE emp_list SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?", [
      status,
      id,
    ])

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: "Employee not found or no changes made",
      })
    }

    const updatedEmployeeData = {
      id: Number.parseInt(id),
      name: `${existingEmployee.first_name} ${existingEmployee.last_name}`,
      status: status,
    }

    socketEvents.employeeUpdated(updatedEmployeeData)

    res.json({
      success: true,
      message: `Employee status updated to ${status}`,
      data: updatedEmployeeData,
    })
  } catch (error) {
    console.error("Error updating employee status:", error)
    res.status(500).json({
      success: false,
      error: "Failed to update employee status",
      message: error.message,
    })
  }
})

// Delete single employee
router.delete("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params

    // Check if employee exists and get their info for confirmation
    const employee = await db.get(
      "SELECT uid, first_name, last_name, id_number, position, department FROM emp_list WHERE uid = ?",
      [id],
    )

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found",
      })
    }

    const result = await db.run("DELETE FROM emp_list WHERE uid = ?", [id])

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: "Employee not found or already deleted",
      })
    }

    const deletedEmployeeData = {
      deletedEmployee: {
        id: employee.uid,
        name: `${employee.first_name} ${employee.last_name}`,
        idNumber: employee.id_number,
        position: employee.position,
        department: employee.department,
      },
    }

    socketEvents.employeeDeleted(employee.uid)

    res.json({
      success: true,
      message: `Employee ${employee.first_name} ${employee.last_name} (ID: ${employee.id_number}) has been successfully deleted`,
      data: deletedEmployeeData,
    })
  } catch (error) {
    console.error("Error deleting employee:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete employee",
      message: error.message,
    })
  }
})

// Update employee by ID
router.put("/:id", async (req, res) => {
  try {
    const db = getDatabase()
    const { id } = req.params
    const {
      firstName,
      middleName,
      lastName,
      age,
      birthDate,
      contactNumber,
      email,
      civilStatus,
      address,
      position,
      department,
      salary,
      hireDate,
      status,
      idNumber,
      idBarcode,
      tinNumber,
      sssNumber,
      pagibigNumber,
      philhealthNumber,
      profilePicture,
      document,
    } = req.body

    console.log("Updating employee:", { id, firstName, lastName, position, department })

    // Check if employee exists
    const existingEmployee = await db.get("SELECT uid FROM emp_list WHERE uid = ?", [id])
    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found",
      })
    }

    // Validation - required fields
    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: "First name and last name are required",
      })
    }

    if (!email || !position || !department) {
      return res.status(400).json({
        success: false,
        error: "Email, position, and department are required",
      })
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid email address",
      })
    }

    // Check if email already exists for other employees
    const existingEmailEmployee = await db.get(
      "SELECT uid, email FROM emp_list WHERE LOWER(email) = LOWER(?) AND uid != ?", 
      [email, id]
    )

    if (existingEmailEmployee) {
      return res.status(400).json({
        success: false,
        error: "An employee with this email address already exists",
      })
    }

    // Check if employee ID already exists for other employees
    if (idNumber) {
      const existingEmployeeId = await db.get(
        "SELECT uid, id_number FROM emp_list WHERE id_number = ? AND uid != ?", 
        [idNumber, id]
      )

      if (existingEmployeeId) {
        return res.status(400).json({
          success: false,
          error: "An employee with this ID already exists",
        })
      }
    }

    // Build dynamic update query
    const updateFields = []
    const updateValues = []

    // Add fields to update
    const fieldsToUpdate = {
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      age: age,
      birth_date: birthDate,
      contact_number: contactNumber,
      email: email,
      civil_status: civilStatus,
      address: address,
      hire_date: hireDate,
      position: position,
      department: department,
      status: status || "Active",
      id_number: idNumber,
      id_barcode: idBarcode,
      salary: salary,
      tin_number: tinNumber,
      sss_number: sssNumber,
      pagibig_number: pagibigNumber,
      philhealth_number: philhealthNumber,
      profile_picture: profilePicture,
      document: document,
    }

    // Only update fields that are provided
    Object.entries(fieldsToUpdate).forEach(([dbField, value]) => {
      if (value !== undefined) {
        updateFields.push(`${dbField} = ?`)
        updateValues.push(value)
      }
    })

    // Add updated timestamp
    updateFields.push("updated_at = CURRENT_TIMESTAMP")
    
    // Add WHERE clause parameter
    updateValues.push(id)

    // Update employee
    const updateQuery = `
      UPDATE emp_list 
      SET ${updateFields.join(", ")}
      WHERE uid = ?
    `

    const result = await db.run(updateQuery, updateValues)

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: "Employee not found or no changes made",
      })
    }

    // Fetch the updated employee
    const updatedEmployee = await db.get(
      `
      SELECT 
        uid as id,
        (first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name) as full_name,
        first_name, middle_name, last_name, age, birth_date, contact_number, email,
        civil_status, address, hire_date, position, department, status, id_number, id_barcode, salary,
        tin_number, sss_number, pagibig_number, philhealth_number,
        profile_picture, document, username, access_level, created_at, updated_at
      FROM emp_list 
      WHERE uid = ?
    `,
      [id]
    )

    const employeeData = {
      id: updatedEmployee.id,
      fullName: updatedEmployee.full_name,
      firstName: updatedEmployee.first_name,
      middleName: updatedEmployee.middle_name,
      lastName: updatedEmployee.last_name,
      age: updatedEmployee.age,
      birthDate: updatedEmployee.birth_date,
      contactNumber: updatedEmployee.contact_number,
      email: updatedEmployee.email,
      civilStatus: updatedEmployee.civil_status,
      address: updatedEmployee.address,
      hireDate: updatedEmployee.hire_date,
      position: updatedEmployee.position,
      department: updatedEmployee.department,
      status: updatedEmployee.status,
      idNumber: updatedEmployee.id_number,
      idBarcode: updatedEmployee.id_barcode,
      salary: updatedEmployee.salary,
      tinNumber: updatedEmployee.tin_number,
      sssNumber: updatedEmployee.sss_number,
      pagibigNumber: updatedEmployee.pagibig_number,
      philhealthNumber: updatedEmployee.philhealth_number,
      profilePicture: updatedEmployee.profile_picture,
      document: updatedEmployee.document,
      username: updatedEmployee.username,
      accessLevel: updatedEmployee.access_level,
      createdAt: updatedEmployee.created_at,
      updatedAt: updatedEmployee.updated_at,
    }

    console.log(
      `Successfully updated employee: ${updatedEmployee.full_name} (ID: ${id})`
    )

    // Emit socket event for real-time updates
    socketEvents.employeeUpdated(employeeData)

    res.json({
      success: true,
      message: `Employee ${updatedEmployee.full_name} has been updated successfully`,
      data: employeeData,
    })
  } catch (error) {
    console.error("Error updating employee:", error)
    res.status(500).json({
      success: false,
      error: "Failed to update employee",
      message: error.message,
    })
  }
})

// Bulk delete employees
router.delete("/bulk", async (req, res) => {
  try {
    const db = getDatabase()
    const { employeeIds } = req.body

    // Validate input
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Employee IDs array is required and cannot be empty",
      })
    }

    // Validate all IDs are numbers
    const invalidIds = employeeIds.filter((id) => !id || isNaN(id))
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: "All employee IDs must be valid numbers",
      })
    }

    // Get employee info before deletion for confirmation
    const placeholders = employeeIds.map(() => "?").join(",")
    const employees = await db.all(
      `SELECT uid, first_name, last_name, id_number FROM emp_list WHERE uid IN (${placeholders})`,
      employeeIds,
    )

    if (employees.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No employees found with the provided IDs",
      })
    }

    // Perform bulk deletion
    const result = await db.run(`DELETE FROM emp_list WHERE uid IN (${placeholders})`, employeeIds)

    const deletedEmployeesData = {
      deletedCount: result.changes,
      deletedEmployees: employees.map((emp) => ({
        id: emp.uid,
        name: `${emp.first_name} ${emp.last_name}`,
        idNumber: emp.id_number,
      })),
    }

    employeeIds.forEach((id) => {
      socketEvents.employeeDeleted(id)
    })

    res.json({
      success: true,
      message: `Successfully deleted ${result.changes} employee(s)`,
      data: deletedEmployeesData,
    })
  } catch (error) {
    console.error("Error bulk deleting employees:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete employees",
      message: error.message,
    })
  }
})

module.exports = router