const express = require("express")
const { getDatabase } = require("../config/database")

const router = express.Router()

router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    database: connection ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    databaseDir: process.env.DATABASE_DIR || process.cwd(),
    processInfo: {
      pid: process.pid,
      cwd: process.cwd(),
      execPath: process.execPath,
      arch: process.arch
    }
  })
})

// Employee validation endpoint
router.get("/employees/validate", async (req, res) => {
  console.log("=== VALIDATION ENDPOINT START ===")
  console.log("Raw query params:", req.query)

  try {
    const db = getDatabase()
    const {
      email,
      username,
      idNumber,
      employeeId,
      idBarcode,
      excludeId,
      philhealthNumber,
      tinNumber,
      sssNumber,
      pagibigNumber,
      contactNumber,
    } = req.query

    // Handle both idNumber and employeeId for backward compatibility
    const actualIdNumber = idNumber || employeeId

    console.log("Validation request received:", {
      email,
      username,
      idNumber: actualIdNumber,
      idBarcode,
      philhealthNumber,
      tinNumber,
      sssNumber,
      pagibigNumber,
      contactNumber,
      excludeId,
    })

    // Validate that at least one field is provided
    if (
      !email &&
      !username &&
      !actualIdNumber &&
      !idBarcode &&
      !philhealthNumber &&
      !tinNumber &&
      !sssNumber &&
      !pagibigNumber &&
      !contactNumber
    ) {
      console.log("No validation fields provided")
      return res.status(400).json({
        success: false,
        error: "At least one field must be provided for validation",
      })
    }

    const validationResults = {}

    // Helper function to check field uniqueness
    const checkFieldUniqueness = async (fieldName, fieldValue, dbColumnName, displayName) => {
      if (!fieldValue || !fieldValue.trim()) return

      try {
        const trimmedValue = fieldValue.trim()

        // Build query with proper parameterization
        let query = `SELECT uid FROM emp_list WHERE LOWER(TRIM(COALESCE(${dbColumnName}, ''))) = LOWER(TRIM(?)) AND COALESCE(${dbColumnName}, '') != ''`
        const params = [trimmedValue]

        // Add exclusion condition if excludeId is provided
        if (excludeId && !isNaN(Number.parseInt(excludeId))) {
          query += " AND uid != ?"
          params.push(Number.parseInt(excludeId))
        }

        console.log(`Executing ${displayName} query:`, {
          query,
          params,
          trimmedValue,
        })

        const result = await db.get(query, params)
        const isAvailable = !result

        validationResults[fieldName] = isAvailable
        console.log(`${displayName} validation result:`, {
          value: trimmedValue,
          available: isAvailable,
          foundRecord: result ? result.uid : null,
        })
      } catch (dbError) {
        console.error(`Database error checking ${displayName}:`, {
          error: dbError.message,
          stack: dbError.stack,
          query: `${dbColumnName} validation`,
          value: fieldValue,
        })
        throw new Error(`Database error while checking ${displayName}: ${dbError.message}`)
      }
    }

    // Check email uniqueness with format validation
    if (email && email.trim()) {
      try {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const trimmedEmail = email.trim()

        if (!emailRegex.test(trimmedEmail)) {
          validationResults.emailAvailable = false
          console.log("Email format validation failed:", trimmedEmail)
        } else {
          await checkFieldUniqueness("emailAvailable", trimmedEmail, "email", "Email")
        }
      } catch (error) {
        console.error("Email validation error:", error)
        return res.status(500).json({
          success: false,
          error: error.message,
        })
      }
    }

    // Check username uniqueness
    if (username && username.trim()) {
      try {
        await checkFieldUniqueness("usernameAvailable", username, "username", "Username")
      } catch (error) {
        console.error("Username validation error:", error)
        return res.status(500).json({
          success: false,
          error: error.message,
        })
      }
    }

    // Check ID number uniqueness
    if (actualIdNumber && actualIdNumber.trim()) {
      try {
        await checkFieldUniqueness("idNumberAvailable", actualIdNumber, "id_number", "ID Number")
        // For backward compatibility, also set employeeIdAvailable
        validationResults.employeeIdAvailable = validationResults.idNumberAvailable
      } catch (error) {
        console.error("ID Number validation error:", error)
        return res.status(500).json({
          success: false,
          error: error.message,
        })
      }
    }

    // Check other fields
    const fieldsToCheck = [
      { param: idBarcode, field: "idBarcodeAvailable", column: "id_barcode", name: "ID Barcode" },
      {
        param: philhealthNumber,
        field: "philhealthNumberAvailable",
        column: "philhealth_number",
        name: "PhilHealth Number",
      },
      { param: tinNumber, field: "tinNumberAvailable", column: "tin_number", name: "TIN Number" },
      { param: sssNumber, field: "sssNumberAvailable", column: "sss_number", name: "SSS Number" },
      { param: pagibigNumber, field: "pagibigNumberAvailable", column: "pagibig_number", name: "Pag-IBIG Number" },
      { param: contactNumber, field: "contactNumberAvailable", column: "contact_number", name: "Contact Number" },
    ]

    for (const { param, field, column, name } of fieldsToCheck) {
      if (param && param.trim()) {
        try {
          await checkFieldUniqueness(field, param, column, name)
        } catch (error) {
          console.error(`${name} validation error:`, error)
          return res.status(500).json({
            success: false,
            error: error.message,
          })
        }
      }
    }

    console.log("Final validation results:", validationResults)
    console.log("=== VALIDATION ENDPOINT END ===")

    res.json({
      success: true,
      data: validationResults,
    })
  } catch (error) {
    console.error("Validation error:", error)
    res.status(500).json({
      success: false,
      error: "Validation failed",
      message: error.message,
    })
  }
})

module.exports = router
