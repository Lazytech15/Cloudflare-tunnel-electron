const express = require("express")
const path = require("path")
const fs = require("fs").promises
const multer = require("multer")
const router = express.Router()

// Get database instance
function getDatabase() {
  const { getDatabase } = require("../config/database")
  return getDatabase()
}

// Configure multer for file uploads
const storage = multer.memoryStorage() // Store files in memory temporarily

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Only allow 1 file at a time
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedMimes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp'
    ]
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type. Only image files are allowed.'), false)
    }
  }
})

// POST /api/profile/:uid/upload - Upload profile picture
router.post("/:uid/upload", upload.single('profile_picture'), async (req, res) => {
  try {
    const { uid } = req.params
    
    // Validate uid parameter
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded"
      })
    }

    const db = getDatabase()
    
    // Check if employee exists
    const employee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    // Create directory structure if it doesn't exist
    const profileDir = path.join(process.cwd(), "uploads", uid.toString(), "profiles")
    
    try {
      await fs.mkdir(profileDir, { recursive: true })
    } catch (mkdirError) {
      console.error("Error creating directory:", mkdirError)
      return res.status(500).json({
        success: false,
        error: "Failed to create upload directory"
      })
    }

    // Generate filename with timestamp to avoid conflicts
    const timestamp = Date.now()
    const originalExtension = path.extname(req.file.originalname).toLowerCase()
    const filename = `profile_${timestamp}${originalExtension}`
    const filePath = path.join(profileDir, filename)

    try {
      // Write file to disk
      await fs.writeFile(filePath, req.file.buffer)
      
      // Get file stats for response
      const stats = await fs.stat(filePath)
      
      res.status(201).json({
        success: true,
        message: "Profile picture uploaded successfully",
        data: {
          employee: {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`
          },
          file: {
            filename: filename,
            originalName: req.file.originalname,
            size: stats.size,
            mimetype: req.file.mimetype,
            url: `/api/profile/${uid}/${filename}`,
            uploadedAt: new Date().toISOString()
          },
          directory: profileDir
        }
      })
      
    } catch (writeError) {
      console.error("Error writing file:", writeError)
      return res.status(500).json({
        success: false,
        error: "Failed to save uploaded file"
      })
    }
    
  } catch (error) {
    console.error("Error uploading profile picture:", error)
    res.status(500).json({
      success: false,
      error: "Failed to upload profile picture",
      message: error.message
    })
  }
})

// POST /api/profile/:uid/upload-replace - Upload and replace existing profile picture
router.post("/:uid/upload-replace", upload.single('profile_picture'), async (req, res) => {
  try {
    const { uid } = req.params
    
    // Validate uid parameter
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded"
      })
    }

    const db = getDatabase()
    
    // Check if employee exists
    const employee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    // Create directory structure if it doesn't exist
    const profileDir = path.join(process.cwd(), "uploads", uid.toString(), "profiles")
    
    try {
      await fs.mkdir(profileDir, { recursive: true })
    } catch (mkdirError) {
      console.error("Error creating directory:", mkdirError)
      return res.status(500).json({
        success: false,
        error: "Failed to create upload directory"
      })
    }

    // Delete existing profile pictures
    let deletedFiles = []
    try {
      const files = await fs.readdir(profileDir)
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      
      for (const file of files) {
        const ext = path.extname(file).toLowerCase()
        if (imageExtensions.includes(ext)) {
          const filePath = path.join(profileDir, file)
          await fs.unlink(filePath)
          deletedFiles.push(file)
        }
      }
    } catch (cleanupError) {
      console.warn("Warning: Could not clean up existing files:", cleanupError.message)
    }

    // Generate filename with timestamp
    const timestamp = Date.now()
    const originalExtension = path.extname(req.file.originalname).toLowerCase()
    const filename = `profile_${timestamp}${originalExtension}`
    const filePath = path.join(profileDir, filename)

    try {
      // Write new file to disk
      await fs.writeFile(filePath, req.file.buffer)
      
      // Get file stats for response
      const stats = await fs.stat(filePath)
      
      res.status(201).json({
        success: true,
        message: "Profile picture uploaded and replaced successfully",
        data: {
          employee: {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`
          },
          file: {
            filename: filename,
            originalName: req.file.originalname,
            size: stats.size,
            mimetype: req.file.mimetype,
            url: `/api/profile/${uid}/${filename}`,
            uploadedAt: new Date().toISOString()
          },
          deleted_files: deletedFiles,
          directory: profileDir
        }
      })
      
    } catch (writeError) {
      console.error("Error writing file:", writeError)
      return res.status(500).json({
        success: false,
        error: "Failed to save uploaded file"
      })
    }
    
  } catch (error) {
    console.error("Error uploading profile picture:", error)
    res.status(500).json({
      success: false,
      error: "Failed to upload profile picture",
      message: error.message
    })
  }
})

// GET /api/profile/:uid - Get employee profile picture
router.get("/:uid", async (req, res) => {
  try {
    const { uid } = req.params
    
    // Validate uid parameter
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }

    const db = getDatabase()
    
    // Check if employee exists
    const employee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    // Construct profile picture directory path
    const profileDir = path.join(process.cwd(), "uploads", uid.toString(), "profiles")
    
    try {
      // Check if profiles directory exists
      await fs.access(profileDir)
      
      // Read directory contents
      const files = await fs.readdir(profileDir)
      
      // Filter for common image file extensions
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      const profilePictures = files.filter(file => {
        const ext = path.extname(file).toLowerCase()
        return imageExtensions.includes(ext)
      })

      if (profilePictures.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No profile picture found for this employee"
        })
      }

      // Use the first profile picture found (you might want to implement logic for selecting a specific one)
      const profilePicture = profilePictures[0]
      const profilePath = path.join(profileDir, profilePicture)
      
      // Get file stats
      const stats = await fs.stat(profilePath)
      
      // Set appropriate content type based on file extension
      const ext = path.extname(profilePicture).toLowerCase()
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', 
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
      }
      
      const contentType = contentTypes[ext] || 'application/octet-stream'
      
      // Set headers
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Length', stats.size)
      res.setHeader('Cache-Control', 'public, max-age=3600') // Cache for 1 hour
      res.setHeader('Last-Modified', stats.mtime.toUTCString())
      
      // Check if client has cached version
      const ifModifiedSince = req.headers['if-modified-since']
      if (ifModifiedSince && new Date(ifModifiedSince) >= stats.mtime) {
        return res.status(304).end()
      }
      
      // Stream the file
      const fileBuffer = await fs.readFile(profilePath)
      res.send(fileBuffer)
      
    } catch (dirError) {
      if (dirError.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          error: "Profile picture directory not found for this employee"
        })
      }
      throw dirError
    }
    
  } catch (error) {
    console.error("Error retrieving profile picture:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve profile picture",
      message: error.message
    })
  }
})

// GET /api/profile/:uid/info - Get profile picture information
router.get("/:uid/info", async (req, res) => {
  try {
    const { uid } = req.params
    
    // Validate uid parameter
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }

    const db = getDatabase()
    
    // Check if employee exists
    const employee = await db.get(
      "SELECT uid, first_name, last_name, profile_picture FROM emp_list WHERE uid = ?", 
      [uid]
    )
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    // Construct profile picture directory path
    const profileDir = path.join(process.cwd(), "uploads", uid.toString(), "profiles")
    
    try {
      // Check if profiles directory exists
      await fs.access(profileDir)
      
      // Read directory contents
      const files = await fs.readdir(profileDir)
      
      // Filter for image files and get their info
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      const profilePictures = []
      
      for (const file of files) {
        const ext = path.extname(file).toLowerCase()
        if (imageExtensions.includes(ext)) {
          const filePath = path.join(profileDir, file)
          const stats = await fs.stat(filePath)
          
          profilePictures.push({
            filename: file,
            size: stats.size,
            modified: stats.mtime,
            extension: ext,
            url: `/api/profile/${uid}/${file}`
          })
        }
      }

      res.json({
        success: true,
        data: {
          employee: {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            has_blob_data: employee.profile_picture ? true : false
          },
          profile_pictures: profilePictures,
          directory: profileDir
        }
      })
      
    } catch (dirError) {
      if (dirError.code === 'ENOENT') {
        return res.json({
          success: true,
          data: {
            employee: {
              uid: employee.uid,
              name: `${employee.first_name} ${employee.last_name}`,
              has_blob_data: employee.profile_picture ? true : false
            },
            profile_pictures: [],
            directory: profileDir,
            message: "Profile picture directory not found"
          }
        })
      }
      throw dirError
    }
    
  } catch (error) {
    console.error("Error retrieving profile picture info:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve profile picture information",
      message: error.message
    })
  }
})

// GET /api/profile/:uid/:filename - Get specific profile picture file
router.get("/:uid/:filename", async (req, res) => {
  try {
    const { uid, filename } = req.params
    
    // Validate parameters
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }
    
    if (!filename) {
      return res.status(400).json({
        success: false,
        error: "Filename is required"
      })
    }

    const db = getDatabase()
    
    // Check if employee exists
    const employee = await db.get("SELECT uid FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    // Construct file path
    const profilePath = path.join(process.cwd(), "uploads", uid.toString(), "profiles", filename)
    
    try {
      // Check if file exists and get stats
      const stats = await fs.stat(profilePath)
      
      // Validate file extension
      const ext = path.extname(filename).toLowerCase()
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      
      if (!imageExtensions.includes(ext)) {
        return res.status(400).json({
          success: false,
          error: "Invalid image file type"
        })
      }
      
      // Set appropriate content type
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png', 
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
      }
      
      const contentType = contentTypes[ext] || 'application/octet-stream'
      
      // Set headers
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Length', stats.size)
      res.setHeader('Cache-Control', 'public, max-age=3600') // Cache for 1 hour
      res.setHeader('Last-Modified', stats.mtime.toUTCString())
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
      
      // Check if client has cached version
      const ifModifiedSince = req.headers['if-modified-since']
      if (ifModifiedSince && new Date(ifModifiedSince) >= stats.mtime) {
        return res.status(304).end()
      }
      
      // Stream the file
      const fileBuffer = await fs.readFile(profilePath)
      res.send(fileBuffer)
      
    } catch (fileError) {
      if (fileError.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          error: "Profile picture file not found"
        })
      }
      throw fileError
    }
    
  } catch (error) {
    console.error("Error retrieving specific profile picture:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve profile picture",
      message: error.message
    })
  }
})

// DELETE /api/profile/:uid/:filename - Delete specific profile picture
router.delete("/:uid/:filename", async (req, res) => {
  try {
    const { uid, filename } = req.params
    
    // Validate parameters
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }
    
    if (!filename) {
      return res.status(400).json({
        success: false,
        error: "Filename is required"
      })
    }

    const db = getDatabase()
    
    // Check if employee exists
    const employee = await db.get("SELECT uid FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    // Construct file path
    const profilePath = path.join(process.cwd(), "uploads", uid.toString(), "profiles", filename)
    
    try {
      // Check if file exists
      await fs.access(profilePath)
      
      // Delete the file
      await fs.unlink(profilePath)
      
      res.json({
        success: true,
        message: "Profile picture deleted successfully",
        data: {
          uid: uid,
          filename: filename
        }
      })
      
    } catch (fileError) {
      if (fileError.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          error: "Profile picture file not found"
        })
      }
      throw fileError
    }
    
  } catch (error) {
    console.error("Error deleting profile picture:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete profile picture",
      message: error.message
    })
  }
})

module.exports = router