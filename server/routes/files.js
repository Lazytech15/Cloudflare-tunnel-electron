const express = require("express")
const path = require("path")
const fs = require("fs")
const { getDatabase } = require("../config/database") // Import getDatabase function
const router = express.Router()

const baseUploadsDir = path.join(process.env.DATABASE_DIR || process.cwd(), "uploads")

// Helper function to get relative path for database storage
const getRelativePath = (fullPath) => {
  return path.relative(baseUploadsDir, fullPath)
}

// Helper function to get full path from relative path
const getFullPath = (relativePath) => {
  return path.join(baseUploadsDir, relativePath)
}

// Helper function to validate user ID and filename
const validateParams = (userId, filename) => {
  if (!userId || !filename) {
    return { isValid: false, error: "User ID and filename are required" }
  }

  if (
    userId.includes("..") ||
    userId.includes("/") ||
    userId.includes("\\") ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return { isValid: false, error: "Invalid userId or filename" }
  }

  return { isValid: true }
}

const getEmployeeById = async (userId) => {
  try {
    console.log("[v0] Getting employee by ID:", userId)
    const db = getDatabase()

    let employee = await db.get("SELECT * FROM emp_list WHERE id_number = ?", [userId])
    if (!employee) {
      employee = await db.get("SELECT * FROM emp_list WHERE uid = ?", [userId])
    }

    console.log("[v0] Employee query result:", employee ? "Found" : "Not found")
    console.log("[v0] Employee data:", employee)
    return employee
  } catch (error) {
    console.error("[v0] Database error getting employee:", error)
    throw error
  }
}

const getEmployeeFiles = async (userId) => {
  try {
    console.log("[v0] Getting employee files for ID:", userId)
    const db = getDatabase()

    let result = await db.get("SELECT profile_picture, document FROM emp_list WHERE id_number = ?", [userId])
    if (!result) {
      result = await db.get("SELECT profile_picture, document FROM emp_list WHERE uid = ?", [userId])
    }

    console.log("[v0] Employee files query result:", result)

    if (!result) {
      console.log("[v0] No employee found with ID:", userId)
      return { profile_picture: null, documents: [] }
    }

    console.log("[v0] Raw profile_picture:", result.profile_picture)
    console.log("[v0] Raw document:", result.document) // Fixed: was result.documents

    let documents = []
    if (result.document) { // Fixed: was result.documents
      try {
        documents = typeof result.document === "string" ? JSON.parse(result.document) : result.document
        if (!Array.isArray(documents)) {
          documents = []
        }
      } catch (parseError) {
        console.error("[v0] Error parsing documents JSON:", parseError)
        documents = []
      }
    }

    const fileData = {
      profile_picture: result.profile_picture,
      documents: documents,
    }
    console.log("[v0] Parsed file data:", fileData)
    return fileData
  } catch (error) {
    console.error("[v0] Database error getting employee files:", error)
    throw error
  }
}

// ============================================================================
// UNIVERSAL FILE SERVING ENDPOINT (MAIN ROUTE - MATCHES UPLOAD.JS)
// ============================================================================

// This is the main file serving route that matches the upload.js system
router.get("/serve/:relativePath", (req, res) => {
  try {
    const { relativePath } = req.params
    const { download } = req.query // Add download query parameter
    const decodedPath = decodeURIComponent(relativePath)

    console.log("📥 File serve request:", decodedPath, download ? "(download mode)" : "(inline mode)")

    // Security check: ensure path doesn't go outside uploads directory
    if (decodedPath.includes("..") || decodedPath.includes("~")) {
      return res.status(400).json({
        success: false,
        error: "Invalid file path",
      })
    }

    const fullPath = getFullPath(decodedPath)
    console.log("📁 Full path:", fullPath)

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      console.log("❌ File not found:", fullPath)
      return res.status(404).json({
        success: false,
        error: "File not found",
        path: decodedPath,
      })
    }

    // Get file extension for content type
    const ext = path.extname(fullPath).toLowerCase()

    const contentTypes = {
      // Images
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
      // Documents
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".txt": "text/plain",
      ".rtf": "application/rtf",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }

    const contentType = contentTypes[ext] || "application/octet-stream"
    const isImage = ext.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i)
    const isPDF = ext === ".pdf"
    const isTXT = ext === ".txt"

    // Set appropriate headers
    res.setHeader("Content-Type", contentType)
    res.setHeader("Cache-Control", "public, max-age=86400") // Cache for 24 hours
    res.setHeader("Access-Control-Allow-Origin", "*") // CORS

    // Set disposition based on file type and download parameter
    if (download === "true") {
      const filename = path.basename(fullPath)
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    } else if (isImage || isPDF || isTXT) {
      res.setHeader("Content-Disposition", "inline") // Display in browser
    } else if (ext === ".doc" || ext === ".docx") {
      res.setHeader("Content-Disposition", "inline")
    } else {
      const filename = path.basename(fullPath)
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`) // Download
    }

    console.log("✅ Serving file with content-type:", contentType)

    // Stream the file
    const fileStream = fs.createReadStream(fullPath)
    fileStream.pipe(res)

    fileStream.on("error", (error) => {
      console.error("❌ Error streaming file:", error)
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Error serving file",
        })
      }
    })

    fileStream.on("end", () => {
      console.log("✅ File served successfully:", decodedPath)
    })
  } catch (error) {
    console.error("❌ Error in file serve endpoint:", error)
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: error.message,
      })
    }
  }
})

// ============================================================================
// FILE INFO ENDPOINT (MATCHES UPLOAD.JS)
// ============================================================================

router.get("/info/:relativePath", (req, res) => {
  try {
    const { relativePath } = req.params
    const decodedPath = decodeURIComponent(relativePath)

    if (decodedPath.includes("..") || decodedPath.includes("~")) {
      return res.status(400).json({
        success: false,
        error: "Invalid file path",
      })
    }

    const fullPath = getFullPath(decodedPath)

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        success: false,
        error: "File not found",
      })
    }

    const stats = fs.statSync(fullPath)
    const filename = path.basename(fullPath)
    const ext = path.extname(fullPath).toLowerCase()

    res.json({
      success: true,
      data: {
        relativePath: decodedPath,
        filename: filename,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        extension: ext,
        url: `/api/files/serve/${encodeURIComponent(decodedPath)}`,
        isImage: !!ext.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i),
        isDocument: !!ext.match(/\.(pdf|doc|docx|txt|rtf|xls|xlsx|ppt|pptx)$/i),
      },
    })
  } catch (error) {
    console.error("Error getting file info:", error)
    res.status(500).json({
      success: false,
      error: "Failed to get file info",
      message: error.message,
    })
  }
})

// ============================================================================
// DELETE FILE ENDPOINT (MATCHES UPLOAD.JS)
// ============================================================================

router.delete("/serve/:relativePath", (req, res) => {
  try {
    const { relativePath } = req.params
    const decodedPath = decodeURIComponent(relativePath)

    console.log("🗑️ File delete request:", decodedPath)

    // Security check
    if (decodedPath.includes("..") || decodedPath.includes("~")) {
      return res.status(400).json({
        success: false,
        error: "Invalid file path",
      })
    }

    const fullPath = getFullPath(decodedPath)

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        success: false,
        error: "File not found",
      })
    }

    fs.unlinkSync(fullPath)
    console.log("✅ File deleted:", fullPath)

    res.json({
      success: true,
      message: "File deleted successfully",
      relativePath: decodedPath,
    })
  } catch (error) {
    console.error("❌ Error deleting file:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete file",
      message: error.message,
    })
  }
})

// ============================================================================
// USER FILES ENDPOINT (MATCHES UPLOAD.JS)
// ============================================================================

router.get("/user/:userId/files", (req, res) => {
  try {
    const { userId } = req.params
    const userDir = path.join(baseUploadsDir, userId)

    if (!fs.existsSync(userDir)) {
      return res.json({
        success: true,
        data: {
          profiles: [],
          documents: [],
          totalFiles: 0,
        },
      })
    }

    const profiles = []
    const documents = []

    // Scan profiles directory
    const profilesDir = path.join(userDir, "profiles")
    if (fs.existsSync(profilesDir)) {
      fs.readdirSync(profilesDir).forEach((filename) => {
        const fullPath = path.join(profilesDir, filename)
        const relativePath = getRelativePath(fullPath)
        const stats = fs.statSync(fullPath)

        profiles.push({
          filename,
          relativePath,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          url: `/api/files/serve/${encodeURIComponent(relativePath)}`,
        })
      })
    }

    // Scan documents directory
    const documentsDir = path.join(userDir, "documents")
    if (fs.existsSync(documentsDir)) {
      fs.readdirSync(documentsDir).forEach((filename) => {
        const fullPath = path.join(documentsDir, filename)
        const relativePath = getRelativePath(fullPath)
        const stats = fs.statSync(fullPath)

        documents.push({
          filename,
          relativePath,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          url: `/api/files/serve/${encodeURIComponent(relativePath)}`,
        })
      })
    }

    res.json({
      success: true,
      data: {
        profiles,
        documents,
        totalFiles: profiles.length + documents.length,
        userId,
      },
    })
  } catch (error) {
    console.error("Error listing user files:", error)
    res.status(500).json({
      success: false,
      error: "Failed to list user files",
      message: error.message,
    })
  }
})

// ============================================================================
// EMPLOYEE FILE RETRIEVAL ENDPOINTS
// ============================================================================

router.get("/employee/:userId", async (req, res) => {
  try {
    const { userId } = req.params
    console.log("📥 Employee file request for userId:", userId)

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      })
    }

    // Get employee details from database
    const employee = await getEmployeeById(userId)
    if (!employee) {
      console.log("[v0] Employee not found in database for ID:", userId)
      return res.status(404).json({
        success: false,
        error: "Employee not found",
      })
    }

    // Get file paths from database
    const fileData = await getEmployeeFiles(userId)

    // Prepare response with file URLs
    const response = {
      success: true,
      data: {
        employee: {
          id_number: employee.id_number || employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          position: employee.position,
          department: employee.department,
          uid: employee.uid,
        },
        files: {
          profile: null,
          documents: [],
        },
      },
    }

    // Add profile picture if exists
    if (fileData.profile_picture) {
      const profilePath = getFullPath(fileData.profile_picture)
      console.log("[v0] Checking profile path:", profilePath)
      if (fs.existsSync(profilePath)) {
        response.data.files.profile = {
          relativePath: fileData.profile_picture,
          url: `/api/files/serve/${encodeURIComponent(fileData.profile_picture)}`,
          filename: path.basename(profilePath),
        }
        console.log("[v0] Profile picture found and added to response")
      } else {
        console.log("[v0] Profile picture file not found on disk:", profilePath)
      }
    } else {
      console.log("[v0] No profile picture path in database")
    }

    // Add documents if exist
    if (fileData.documents && fileData.documents.length > 0) {
      response.data.files.documents = fileData.documents
        .filter((doc) => {
          const docPath = getFullPath(doc.relativePath)
          const exists = fs.existsSync(docPath)
          console.log("[v0] Document check:", doc.relativePath, exists ? "exists" : "not found")
          return exists
        })
        .map((doc) => ({
          ...doc,
          url: `/api/files/serve/${encodeURIComponent(doc.relativePath)}`,
        }))
      console.log("[v0] Documents added to response:", response.data.files.documents.length)
    } else {
      console.log("[v0] No documents found in database")
    }

    console.log("✅ Employee files retrieved successfully")
    console.log("[v0] Final response:", JSON.stringify(response, null, 2))
    res.json(response)
  } catch (error) {
    console.error("❌ Error retrieving employee files:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve employee files",
      message: error.message,
    })
  }
})

router.get("/employee/:userId/profile", async (req, res) => {
  try {
    const { userId } = req.params
    console.log("📥 Employee profile request for userId:", userId)

    const fileData = await getEmployeeFiles(userId)

    if (!fileData.profile_picture) {
      return res.status(404).json({
        success: false,
        error: "No profile picture found for this employee",
      })
    }

    const profilePath = getFullPath(fileData.profile_picture)
    if (!fs.existsSync(profilePath)) {
      return res.status(404).json({
        success: false,
        error: "Profile picture file not found on disk",
      })
    }

    // Redirect to the file serving endpoint
    res.redirect(`/api/files/serve/${encodeURIComponent(fileData.profile_picture)}`)
  } catch (error) {
    console.error("❌ Error retrieving employee profile:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve employee profile",
      message: error.message,
    })
  }
})

router.get("/employee/:userId/documents", async (req, res) => {
  try {
    const { userId } = req.params
    console.log("📥 Employee documents request for userId:", userId)

    const fileData = await getEmployeeFiles(userId)

    if (!fileData.documents || fileData.documents.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: "No documents found for this employee",
      })
    }

    // Filter existing documents and add URLs
    const existingDocuments = fileData.documents
      .filter((doc) => {
        const docPath = getFullPath(doc.relativePath)
        return fs.existsSync(docPath)
      })
      .map((doc) => ({
        ...doc,
        url: `/api/files/serve/${encodeURIComponent(doc.relativePath)}`,
      }))

    res.json({
      success: true,
      data: existingDocuments,
      count: existingDocuments.length,
    })
  } catch (error) {
    console.error("❌ Error retrieving employee documents:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve employee documents",
      message: error.message,
    })
  }
})

// ============================================================================
// ADMIN/UTILITY ENDPOINTS
// ============================================================================

// List all users who have uploaded files
router.get("/users", (req, res) => {
  try {
    if (!fs.existsSync(baseUploadsDir)) {
      return res.json({
        success: true,
        data: [],
        message: "Uploads directory not found",
      })
    }

    const userDirs = fs
      .readdirSync(baseUploadsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory() && dirent.name !== "temp") // Exclude temp directory
      .map((dirent) => dirent.name)

    const userList = userDirs.map((userId) => {
      const userDir = path.join(baseUploadsDir, userId)
      const profilesDir = path.join(userDir, "profiles")
      const documentsDir = path.join(userDir, "documents")

      const profileCount = fs.existsSync(profilesDir)
        ? fs.readdirSync(profilesDir).filter((file) => {
            const ext = path.extname(file).toLowerCase()
            return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)
          }).length
        : 0

      const documentCount = fs.existsSync(documentsDir)
        ? fs.readdirSync(documentsDir).filter((file) => {
            const ext = path.extname(file).toLowerCase()
            return [".pdf", ".doc", ".docx", ".txt", ".rtf", ".xls", ".xlsx", ".ppt", ".pptx"].includes(ext)
          }).length
        : 0

      return {
        userId,
        profileCount,
        documentCount,
        totalFiles: profileCount + documentCount,
        profilesUrl: `/api/files/${userId}/profiles`,
        documentsUrl: `/api/files/${userId}/documents`,
        allFilesUrl: `/api/files/user/${userId}/files`,
      }
    })

    res.json({
      success: true,
      data: userList,
      count: userList.length,
    })
  } catch (error) {
    console.error("Error listing users:", error)
    res.status(500).json({
      success: false,
      error: "Failed to list users",
      message: error.message,
    })
  }
})

// Get user file summary
router.get("/:userId/summary", (req, res) => {
  try {
    const { userId } = req.params

    // Validate user ID
    if (!userId || userId.includes("..") || userId.includes("/") || userId.includes("\\")) {
      return res.status(400).json({
        success: false,
        error: "Invalid userId",
      })
    }

    const userDir = path.join(baseUploadsDir, userId)
    const profilesDir = path.join(userDir, "profiles")
    const documentsDir = path.join(userDir, "documents")

    if (!fs.existsSync(userDir)) {
      return res.status(404).json({
        success: false,
        error: "User directory not found",
      })
    }

    const profileFiles = fs.existsSync(profilesDir)
      ? fs.readdirSync(profilesDir).filter((file) => {
          const ext = path.extname(file).toLowerCase()
          return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)
        })
      : []

    const documentFiles = fs.existsSync(documentsDir)
      ? fs.readdirSync(documentsDir).filter((file) => {
          const ext = path.extname(file).toLowerCase()
          return [".pdf", ".doc", ".docx", ".txt", ".rtf", ".xls", ".xlsx", ".ppt", ".pptx"].includes(ext)
        })
      : []

    // Calculate total size
    let totalSize = 0

    profileFiles.forEach((file) => {
      const filePath = path.join(profilesDir, file)
      if (fs.existsSync(filePath)) {
        totalSize += fs.statSync(filePath).size
      }
    })

    documentFiles.forEach((file) => {
      const filePath = path.join(documentsDir, file)
      if (fs.existsSync(filePath)) {
        totalSize += fs.statSync(filePath).size
      }
    })

    res.json({
      success: true,
      data: {
        userId,
        profileCount: profileFiles.length,
        documentCount: documentFiles.length,
        totalFiles: profileFiles.length + documentFiles.length,
        totalSize,
        totalSizeFormatted: `${(totalSize / (1024 * 1024)).toFixed(2)} MB`,
        latestProfile: profileFiles.length > 0 ? profileFiles[profileFiles.length - 1] : null,
        latestDocument: documentFiles.length > 0 ? documentFiles[documentFiles.length - 1] : null,
        profilesUrl: `/api/files/${userId}/profiles`,
        documentsUrl: `/api/files/${userId}/documents`,
        allFilesUrl: `/api/files/user/${userId}/files`,
      },
    })
  } catch (error) {
    console.error("Error getting user summary:", error)
    res.status(500).json({
      success: false,
      error: "Failed to get user summary",
      message: error.message,
    })
  }
})

module.exports = router
