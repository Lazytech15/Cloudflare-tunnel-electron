const express = require("express")
const path = require("path")
const fs = require("fs").promises
const multer = require("multer")
const router = express.Router()

const archiver = require('archiver')

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

// Helper function to get profile picture info for a single employee
async function getEmployeeProfileInfo(uid) {
  const profileDir = path.join(process.cwd(), "uploads", uid.toString(), "profiles")
  
  try {
    await fs.access(profileDir)
    const files = await fs.readdir(profileDir)
    
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
    
    // Sort by modification date, newest first
    profilePictures.sort((a, b) => new Date(b.modified) - new Date(a.modified))
    
    return profilePictures
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

// GET /api/profile/bulk - Get all employees with their profile pictures
router.get("/bulk", async (req, res) => {
  try {
    const db = getDatabase()
    
    // Get query parameters for pagination and filtering
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 50 // Default 50 employees per page
    const offset = (page - 1) * limit
    const search = req.query.search || ''
    const department = req.query.department || ''
    
    // Build the query with optional filters
    let whereClause = 'WHERE 1=1'
    const params = []
    
    if (search) {
      whereClause += ' AND (first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name, " ", last_name) LIKE ?)'
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    
    if (department) {
      whereClause += ' AND department = ?'
      params.push(department)
    }
    
    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM emp_list ${whereClause}`
    const countResult = await db.get(countQuery, params)
    const totalEmployees = countResult.total
    
    // Get employees with pagination
    const employeesQuery = `
      SELECT uid, first_name, last_name, department, position, email, profile_picture
      FROM emp_list 
      ${whereClause}
      ORDER BY first_name, last_name
      LIMIT ? OFFSET ?
    `
    params.push(limit, offset)
    
    const employees = await db.all(employeesQuery, params)
    
    // Get profile picture info for each employee
    const employeesWithProfiles = await Promise.allSettled(
      employees.map(async (employee) => {
        try {
          const profilePictures = await getEmployeeProfileInfo(employee.uid)
          
          return {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            first_name: employee.first_name,
            last_name: employee.last_name,
            department: employee.department,
            position: employee.position,
            email: employee.email,
            has_blob_data: employee.profile_picture ? true : false,
            profile_pictures: profilePictures,
            current_profile: profilePictures.length > 0 ? profilePictures[0] : null,
            profile_url: profilePictures.length > 0 ? `/api/profile/${employee.uid}` : null
          }
        } catch (error) {
          console.warn(`Error getting profile for employee ${employee.uid}:`, error.message)
          return {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            first_name: employee.first_name,
            last_name: employee.last_name,
            department: employee.department,
            position: employee.position,
            email: employee.email,
            has_blob_data: employee.profile_picture ? true : false,
            profile_pictures: [],
            current_profile: null,
            profile_url: null,
            error: error.message
          }
        }
      })
    )
    
    // Process results and separate successful from failed
    const successfulResults = []
    const failedResults = []
    
    employeesWithProfiles.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulResults.push(result.value)
      } else {
        failedResults.push({
          employee: employees[index],
          error: result.reason.message
        })
      }
    })
    
    // Calculate pagination info
    const totalPages = Math.ceil(totalEmployees / limit)
    const hasNextPage = page < totalPages
    const hasPreviousPage = page > 1
    
    res.json({
      success: true,
      data: {
        employees: successfulResults,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_employees: totalEmployees,
          employees_per_page: limit,
          has_next_page: hasNextPage,
          has_previous_page: hasPreviousPage,
          next_page: hasNextPage ? page + 1 : null,
          previous_page: hasPreviousPage ? page - 1 : null
        },
        filters: {
          search: search || null,
          department: department || null
        },
        statistics: {
          employees_with_profiles: successfulResults.filter(emp => emp.profile_pictures.length > 0).length,
          employees_without_profiles: successfulResults.filter(emp => emp.profile_pictures.length === 0).length,
          employees_with_blob_data: successfulResults.filter(emp => emp.has_blob_data).length,
          failed_retrievals: failedResults.length
        }
      },
      failed_results: failedResults.length > 0 ? failedResults : undefined
    })
    
  } catch (error) {
    console.error("Error fetching bulk employee profiles:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch employee profiles",
      message: error.message
    })
  }
})

// GET /api/profile/bulk/simple - Get simplified list of all employees with profile status
router.get("/bulk/simple", async (req, res) => {
  try {
    const db = getDatabase()
    
    // Get all employees
    const employees = await db.all(`
      SELECT uid, first_name, last_name, department, profile_picture
      FROM emp_list 
      ORDER BY first_name, last_name
    `)
    
    // Check profile picture existence for each employee (lightweight check)
    const employeesWithProfileStatus = await Promise.allSettled(
      employees.map(async (employee) => {
        try {
          const profileDir = path.join(process.cwd(), "uploads", employee.uid.toString(), "profiles")
          
          try {
            await fs.access(profileDir)
            const files = await fs.readdir(profileDir)
            const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
            const hasProfilePicture = files.some(file => {
              const ext = path.extname(file).toLowerCase()
              return imageExtensions.includes(ext)
            })
            
            return {
              uid: employee.uid,
              name: `${employee.first_name} ${employee.last_name}`,
              department: employee.department,
              has_profile_file: hasProfilePicture,
              has_blob_data: employee.profile_picture ? true : false,
              profile_url: hasProfilePicture ? `/api/profile/${employee.uid}` : null
            }
          } catch (dirError) {
            return {
              uid: employee.uid,
              name: `${employee.first_name} ${employee.last_name}`,
              department: employee.department,
              has_profile_file: false,
              has_blob_data: employee.profile_picture ? true : false,
              profile_url: null
            }
          }
        } catch (error) {
          return {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            department: employee.department,
            has_profile_file: false,
            has_blob_data: employee.profile_picture ? true : false,
            profile_url: null,
            error: error.message
          }
        }
      })
    )
    
    const results = employeesWithProfileStatus
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value)
    
    const statistics = {
      total_employees: results.length,
      with_profile_files: results.filter(emp => emp.has_profile_file).length,
      with_blob_data: results.filter(emp => emp.has_blob_data).length,
      without_any_profile: results.filter(emp => !emp.has_profile_file && !emp.has_blob_data).length
    }
    
    res.json({
      success: true,
      data: {
        employees: results,
        statistics: statistics
      }
    })
    
  } catch (error) {
    console.error("Error fetching simple employee profiles:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch employee profiles",
      message: error.message
    })
  }
})

// GET /api/profile/bulk/download - Download all profile images as a ZIP file
router.get("/bulk/download", async (req, res) => {
  try {
    const db = getDatabase()
    
    // Get query parameters for filtering
    const department = req.query.department || ''
    const search = req.query.search || ''
    const uids = req.query.uids ? req.query.uids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : []
    
    // Build query based on filters
    let whereClause = 'WHERE 1=1'
    const params = []
    
    if (uids.length > 0) {
      // If specific UIDs are provided, use them
      const placeholders = uids.map(() => '?').join(',')
      whereClause += ` AND uid IN (${placeholders})`
      params.push(...uids)
    } else {
      // Otherwise, apply search and department filters
      if (search) {
        whereClause += ' AND (first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name, " ", last_name) LIKE ?)'
        params.push(`%${search}%`, `%${search}%`, `%${search}%`)
      }
      
      if (department) {
        whereClause += ' AND department = ?'
        params.push(department)
      }
    }
    
    // Get employees
    const employeesQuery = `
      SELECT uid, first_name, last_name, department, position
      FROM emp_list 
      ${whereClause}
      ORDER BY first_name, last_name
    `
    
    const employees = await db.all(employeesQuery, params)
    
    if (employees.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No employees found matching the criteria"
      })
    }
    
    // Set response headers for ZIP download
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const zipFilename = `profile_images_${timestamp}.zip`
    
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`)
    res.setHeader('Cache-Control', 'private, no-cache')
    
    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 } // Compression level (0-9)
    })
    
    // Handle archive errors
    archive.on('error', (err) => {
      console.error('Archive error:', err)
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Failed to create archive"
        })
      }
    })
    
    // Pipe archive to response
    archive.pipe(res)
    
    let addedCount = 0
    let skippedCount = 0
    const errors = []
    
    // Process each employee
    for (const employee of employees) {
      try {
        const profileDir = path.join(process.cwd(), "uploads", employee.uid.toString(), "profiles")
        
        // Check if profile directory exists
        await fs.access(profileDir)
        const files = await fs.readdir(profileDir)
        
        // Find the most recent image file
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
        let mostRecentFile = null
        let mostRecentTime = 0
        
        for (const file of files) {
          const ext = path.extname(file).toLowerCase()
          if (imageExtensions.includes(ext)) {
            const filePath = path.join(profileDir, file)
            const stats = await fs.stat(filePath)
            
            if (stats.mtime.getTime() > mostRecentTime) {
              mostRecentTime = stats.mtime.getTime()
              mostRecentFile = { file, ext }
            }
          }
        }
        
        if (mostRecentFile) {
          const sourcePath = path.join(profileDir, mostRecentFile.file)
          
          // Create a clean filename for the archive
          const employeeName = `${employee.first_name}_${employee.last_name}`.replace(/[^a-zA-Z0-9]/g, '_')
          const archiveFilename = `${employee.uid}_${employeeName}${mostRecentFile.ext}`
          
          // Add file to archive
          archive.file(sourcePath, { name: archiveFilename })
          addedCount++
        } else {
          skippedCount++
          errors.push({
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            reason: "No image files found"
          })
        }
        
      } catch (error) {
        skippedCount++
        errors.push({
          uid: employee.uid,
          name: `${employee.first_name} ${employee.last_name}`,
          reason: error.code === 'ENOENT' ? "Profile directory not found" : error.message
        })
      }
    }
    
    // Add a summary file to the archive
    const summary = {
      generated_at: new Date().toISOString(),
      total_employees: employees.length,
      images_included: addedCount,
      images_skipped: skippedCount,
      filters_applied: {
        department: department || null,
        search: search || null,
        specific_uids: uids.length > 0 ? uids : null
      },
      errors: errors
    }
    
    archive.append(JSON.stringify(summary, null, 2), { name: 'download_summary.json' })
    
    // Finalize the archive
    await archive.finalize()
    
  } catch (error) {
    console.error("Error creating bulk download:", error)
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Failed to create bulk download",
        message: error.message
      })
    }
  }
})

// POST /api/profile/bulk/download - Download specific profile images as ZIP (with request body)
router.post("/bulk/download", async (req, res) => {
  try {
    const { uids, include_summary = true, compression_level = 6 } = req.body
    
    if (!uids || !Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "UIDs array is required in request body"
      })
    }
    
    // Validate UIDs
    const validUids = uids.filter(uid => !isNaN(parseInt(uid))).map(uid => parseInt(uid))
    
    if (validUids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid UIDs provided"
      })
    }
    
    const db = getDatabase()
    
    // Get employee information for the provided UIDs
    const placeholders = validUids.map(() => '?').join(',')
    const employees = await db.all(`
      SELECT uid, first_name, last_name, department, position
      FROM emp_list 
      WHERE uid IN (${placeholders})
      ORDER BY first_name, last_name
    `, validUids)
    
    if (employees.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No employees found for the provided UIDs"
      })
    }
    
    // Set response headers
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const zipFilename = `profile_images_${timestamp}.zip`
    
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`)
    res.setHeader('Cache-Control', 'private, no-cache')
    
    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: Math.min(Math.max(compression_level, 0), 9) }
    })
    
    archive.on('error', (err) => {
      console.error('Archive error:', err)
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Failed to create archive"
        })
      }
    })
    
    archive.pipe(res)
    
    let addedCount = 0
    let skippedCount = 0
    const errors = []
    
    // Process each employee
    for (const employee of employees) {
      try {
        const profileDir = path.join(process.cwd(), "uploads", employee.uid.toString(), "profiles")
        
        await fs.access(profileDir)
        const files = await fs.readdir(profileDir)
        
        // Find most recent image
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
        let mostRecentFile = null
        let mostRecentTime = 0
        
        for (const file of files) {
          const ext = path.extname(file).toLowerCase()
          if (imageExtensions.includes(ext)) {
            const filePath = path.join(profileDir, file)
            const stats = await fs.stat(filePath)
            
            if (stats.mtime.getTime() > mostRecentTime) {
              mostRecentTime = stats.mtime.getTime()
              mostRecentFile = { file, ext }
            }
          }
        }
        
        if (mostRecentFile) {
          const sourcePath = path.join(profileDir, mostRecentFile.file)
          const employeeName = `${employee.first_name}_${employee.last_name}`.replace(/[^a-zA-Z0-9]/g, '_')
          const archiveFilename = `${employee.uid}_${employeeName}${mostRecentFile.ext}`
          
          archive.file(sourcePath, { name: archiveFilename })
          addedCount++
        } else {
          skippedCount++
          errors.push({
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            reason: "No image files found"
          })
        }
        
      } catch (error) {
        skippedCount++
        errors.push({
          uid: employee.uid,
          name: `${employee.first_name} ${employee.last_name}`,
          reason: error.code === 'ENOENT' ? "Profile directory not found" : error.message
        })
      }
    }
    
    // Add summary if requested
    if (include_summary) {
      const summary = {
        generated_at: new Date().toISOString(),
        requested_uids: validUids,
        total_employees_found: employees.length,
        images_included: addedCount,
        images_skipped: skippedCount,
        compression_level: compression_level,
        errors: errors
      }
      
      archive.append(JSON.stringify(summary, null, 2), { name: 'download_summary.json' })
    }
    
    await archive.finalize()
    
  } catch (error) {
    console.error("Error creating bulk download:", error)
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Failed to create bulk download",
        message: error.message
      })
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