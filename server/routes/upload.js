const express = require("express")
const multer = require("multer")
const path = require("path")
const fs = require("fs")
const { getDatabase, initDatabase } = require("../config/database")
const router = express.Router()

const baseUploadsDir = path.join(process.env.DATABASE_DIR || process.cwd(), "uploads")

// Helper function to create user-specific directories
const createUserDirectories = (userId) => {
  const userDir = path.join(baseUploadsDir, userId.toString())
  const profilesDir = path.join(userDir, "profiles")
  const documentsDir = path.join(userDir, "documents")

  const dirs = [userDir, profilesDir, documentsDir]

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log(`📁 Created directory: ${dir}`)
    }
  })

  return { profilesDir, documentsDir }
}

// Helper function to generate unique filename
const generateUniqueFilename = (originalName, type = "file") => {
  const timestamp = Date.now()
  const random = Math.round(Math.random() * 1e9)
  const extension = path.extname(originalName)
  return `${type}-${timestamp}-${random}${extension}`
}

// Helper function to get relative path for database storage
const getRelativePath = (fullPath) => {
  return path.relative(baseUploadsDir, fullPath)
}

// Helper function to get full path from relative path
const getFullPath = (relativePath) => {
  return path.join(baseUploadsDir, relativePath)
}

const updateEmployeeProfilePicture = async (userId, relativePath) => {
  try {
    console.log("[v0] Updating profile picture for userId:", userId)
    console.log("[v0] With relativePath:", relativePath)

    const db = getDatabase()
    const query = "UPDATE emp_list SET profile_picture = ? WHERE id_number = ?"
    const result = await db.run(query, [relativePath, userId])

    console.log("[v0] Profile picture update result:", result)
    console.log("✅ Profile picture path saved to database:", relativePath)
    return result
  } catch (error) {
    console.error("[v0] Database error updating profile picture:", error)
    throw error
  }
}

const updateEmployeeDocuments = async (userId, documentsArray) => {
  try {
    console.log("[v0] Updating documents for userId:", userId)
    console.log("[v0] With documents:", documentsArray)

    const db = getDatabase()
    const documentsJson = JSON.stringify(documentsArray)
    const query = "UPDATE emp_list SET document = ? WHERE id_number = ?"
    const result = await db.run(query, [documentsJson, userId])

    console.log("[v0] Documents update result:", result)
    console.log("✅ Documents paths saved to database:", documentsJson)
    return result
  } catch (error) {
    console.error("[v0] Database error updating documents:", error)
    throw error
  }
}

const getEmployeeDocuments = async (userId) => {
  try {
    console.log("[v0] Getting documents for userId:", userId)

    const db = getDatabase()
    const query = "SELECT document FROM emp_list WHERE id_number = ?"
    const result = await db.get(query, [userId])

    console.log("[v0] Documents query result:", result)
    
    const documents = result && result.document ? JSON.parse(result.document) : []
    console.log("[v0] Parsed documents:", documents)
    return documents
  } catch (error) {
    console.error("[v0] Database error getting documents:", error)
    throw error
  }
}

const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(baseUploadsDir, "temp")
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    cb(null, tempDir)
  },
  filename: (req, file, cb) => {
    const uniqueName = generateUniqueFilename(file.originalname, "temp")
    cb(null, uniqueName)
  },
})

const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
  const mimetype = allowedTypes.test(file.mimetype)

  if (mimetype && extname) {
    return cb(null, true)
  } else {
    cb(new Error("Only image files are allowed (jpeg, jpg, png, gif, webp)"))
  }
}

const documentFilter = (req, file, cb) => {
  const allowedTypes = /pdf|doc|docx|txt|rtf|xls|xlsx|ppt|pptx/
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
  const mimetype = /application|text/.test(file.mimetype)

  if (mimetype && extname) {
    return cb(null, true)
  } else {
    cb(new Error("Only document files are allowed (pdf, doc, docx, txt, rtf, xls, xlsx, ppt, pptx)"))
  }
}

const uploadProfile = multer({
  storage: tempStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for images
  },
  fileFilter: imageFilter,
})

const uploadDocument = multer({
  storage: tempStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for documents
  },
  fileFilter: documentFilter,
})

router.post("/profile-picture", (req, res) => {
  console.log("📤 Profile picture upload request received")

  uploadProfile.single("profilePicture")(req, res, async (err) => {
    if (err) {
      console.error("❌ Multer error:", err.message)
      return res.status(400).json({
        success: false,
        error: err.message,
      })
    }

    try {
      const userId = req.body.userId || req.query.userId || req.params.userId || req.user?.id
      console.log("[v0] Profile upload - User ID from body:", req.body.userId)
      console.log("[v0] Profile upload - User ID from query:", req.query.userId)
      console.log("[v0] Profile upload - Final userId:", userId)

      if (!userId) {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path)
        }
        return res.status(400).json({
          success: false,
          error: "User ID is required",
        })
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No profile picture uploaded",
        })
      }

      const { profilesDir } = createUserDirectories(userId)

      const finalFilename = generateUniqueFilename(req.file.originalname, "profile")
      const finalPath = path.join(profilesDir, finalFilename)

      fs.renameSync(req.file.path, finalPath)

      const relativePath = getRelativePath(finalPath)

      try {
        console.log("[v0] About to update database with userId:", userId, "relativePath:", relativePath)
        const dbResult = await updateEmployeeProfilePicture(userId, relativePath)
        console.log("[v0] Database update successful:", dbResult)
      } catch (dbError) {
        console.error("[v0] Failed to save profile picture path to database:", dbError)
        // Don't fail the upload, but log the error
      }

      console.log("✅ File saved to:", finalPath)
      console.log("💾 Relative path for DB:", relativePath)

      res.json({
        success: true,
        message: "Profile picture uploaded successfully",
        data: {
          filename: finalFilename,
          originalName: req.file.originalname,
          size: req.file.size,
          relativePath: relativePath,
          fullPath: finalPath,
          url: `/api/files/serve/${encodeURIComponent(relativePath)}`,
          type: "profile-image",
          userId: userId,
        },
      })
    } catch (error) {
      console.error("❌ Profile upload error:", error)

      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }

      res.status(500).json({
        success: false,
        error: "Failed to upload profile picture",
        message: error.message,
      })
    }
  })
})

// Fixed version for document upload endpoint
router.post("/document", (req, res) => {
  console.log("📤 Document upload request received")

  uploadDocument.single("document")(req, res, async (err) => {
    if (err) {
      console.error("❌ Multer error:", err.message)
      return res.status(400).json({
        success: false,
        error: err.message,
      })
    }

    try {
      const userId = req.body.userId || req.query.userId || req.params.userId || req.user?.id
      console.log("🆔 User ID:", userId)

      if (!userId) {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path)
        }
        return res.status(400).json({
          success: false,
          error: "User ID is required",
        })
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No document uploaded",
        })
      }

      const { documentsDir } = createUserDirectories(userId)

      const finalFilename = generateUniqueFilename(req.file.originalname, "document")
      const finalPath = path.join(documentsDir, finalFilename)

      // Move file from temp to final location
      fs.renameSync(req.file.path, finalPath)

      const relativePath = getRelativePath(finalPath)

      try {
        // Get existing documents
        const existingDocuments = await getEmployeeDocuments(userId)
        
        // Create new document object
        const newDocument = {
          filename: finalFilename,
          originalName: req.file.originalname,
          relativePath: relativePath,
          size: req.file.size,
          uploadedAt: new Date().toISOString(),
          type: path.extname(req.file.originalname).toLowerCase(),
        }

        // Update database with new document list
        const updatedDocuments = [...existingDocuments, newDocument]
        await updateEmployeeDocuments(userId, updatedDocuments)
        
        console.log("✅ Document saved to database successfully")
        
      } catch (dbError) {
        console.error("❌ Failed to save document path to database:", dbError)
        
        // IMPORTANT: Delete the uploaded file since database save failed
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath)
          console.log("🗑️ Deleted uploaded file due to database error")
        }
        
        // Return error to client
        return res.status(500).json({
          success: false,
          error: "Failed to save document information to database",
          message: dbError.message,
        })
      }

      console.log("✅ File saved to:", finalPath)
      console.log("💾 Relative path for DB:", relativePath)

      res.json({
        success: true,
        message: "Document uploaded successfully",
        data: {
          filename: finalFilename,
          originalName: req.file.originalname,
          size: req.file.size,
          relativePath: relativePath,
          fullPath: finalPath,
          url: `/api/files/serve/${encodeURIComponent(relativePath)}`,
          type: "document",
          userId: userId,
        },
      })
    } catch (error) {
      console.error("❌ Document upload error:", error)

      // Clean up temp file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }

      res.status(500).json({
        success: false,
        error: "Failed to upload document",
        message: error.message,
      })
    }
  })
})

router.get("/serve/:relativePath", (req, res) => {
  try {
    const { relativePath } = req.params
    const decodedPath = decodeURIComponent(relativePath)

    console.log("📥 File serve request:", decodedPath)

    if (decodedPath.includes("..") || decodedPath.includes("~")) {
      return res.status(400).json({
        success: false,
        error: "Invalid file path",
      })
    }

    const fullPath = getFullPath(decodedPath)
    console.log("📁 Full path:", fullPath)

    if (!fs.existsSync(fullPath)) {
      console.log("❌ File not found:", fullPath)
      return res.status(404).json({
        success: false,
        error: "File not found",
        path: decodedPath,
      })
    }

    const ext = path.extname(fullPath).toLowerCase()

    const contentTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
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

    res.setHeader("Content-Type", contentType)
    res.setHeader("Cache-Control", "public, max-age=86400")
    res.setHeader("Access-Control-Allow-Origin", "*")

    if (isImage || isPDF || isTXT) {
      res.setHeader("Content-Disposition", "inline")
    } else {
      const filename = path.basename(fullPath)
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    }

    console.log("✅ Serving file with content-type:", contentType)

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

router.delete("/serve/:relativePath", (req, res) => {
  try {
    const { relativePath } = req.params
    const decodedPath = decodeURIComponent(relativePath)

    console.log("🗑️ File delete request:", decodedPath)

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

module.exports = router
