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
    fileSize: 50 * 1024 * 1024, // 50MB limit for documents
    files: 5 // Allow up to 5 files at a time
  },
  fileFilter: (req, file, cb) => {
    // Check file type - Allow various document types
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'text/plain',
      'text/csv',
      'application/rtf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'application/zip',
      'application/x-rar-compressed'
    ]
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only document and image files are allowed.`), false)
    }
  }
})

// Helper function to get document info for a single employee
async function getEmployeeDocumentInfo(uid) {
  const documentsDir = path.join(process.cwd(), "uploads", uid.toString(), "documents")
  
  try {
    await fs.access(documentsDir)
    const files = await fs.readdir(documentsDir)
    
    const allowedExtensions = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.txt', '.csv', '.rtf', '.jpg', '.jpeg', '.png', '.gif', 
      '.webp', '.bmp', '.zip', '.rar'
    ]
    const documents = []
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      if (allowedExtensions.includes(ext)) {
        const filePath = path.join(documentsDir, file)
        const stats = await fs.stat(filePath)
        
        documents.push({
          filename: file,
          size: stats.size,
          modified: stats.mtime,
          extension: ext,
          url: `/api/document/${uid}/${file}`,
          type: getDocumentType(ext)
        })
      }
    }
    
    // Sort by modification date, newest first
    documents.sort((a, b) => new Date(b.modified) - new Date(a.modified))
    
    return documents
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

// Helper function to determine document type based on extension
function getDocumentType(extension) {
  const types = {
    '.pdf': 'PDF Document',
    '.doc': 'Word Document',
    '.docx': 'Word Document',
    '.xls': 'Excel Spreadsheet',
    '.xlsx': 'Excel Spreadsheet',
    '.ppt': 'PowerPoint Presentation',
    '.pptx': 'PowerPoint Presentation',
    '.txt': 'Text File',
    '.csv': 'CSV File',
    '.rtf': 'Rich Text Format',
    '.jpg': 'Image',
    '.jpeg': 'Image',
    '.png': 'Image',
    '.gif': 'Image',
    '.webp': 'Image',
    '.bmp': 'Image',
    '.zip': 'Archive',
    '.rar': 'Archive'
  }
  return types[extension.toLowerCase()] || 'Document'
}

// GET /api/documents/bulk - Get all employees with their documents
router.get("/bulk", async (req, res) => {
  try {
    const db = getDatabase()
    
    // Get query parameters for pagination and filtering
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 50
    const offset = (page - 1) * limit
    const search = req.query.search || ''
    const department = req.query.department || ''
    const document_type = req.query.document_type || ''
    
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
      SELECT uid, first_name, last_name, department, position, email
      FROM emp_list 
      ${whereClause}
      ORDER BY first_name, last_name
      LIMIT ? OFFSET ?
    `
    params.push(limit, offset)
    
    const employees = await db.all(employeesQuery, params)
    
    // Get document info for each employee
    const employeesWithDocuments = await Promise.allSettled(
      employees.map(async (employee) => {
        try {
          const documents = await getEmployeeDocumentInfo(employee.uid)
          
          // Filter by document type if specified
          const filteredDocuments = document_type ? 
            documents.filter(doc => doc.type.toLowerCase().includes(document_type.toLowerCase())) : 
            documents
          
          return {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            first_name: employee.first_name,
            last_name: employee.last_name,
            department: employee.department,
            position: employee.position,
            email: employee.email,
            documents: filteredDocuments,
            document_count: filteredDocuments.length,
            total_size: filteredDocuments.reduce((sum, doc) => sum + doc.size, 0),
            document_types: [...new Set(filteredDocuments.map(doc => doc.type))]
          }
        } catch (error) {
          console.warn(`Error getting documents for employee ${employee.uid}:`, error.message)
          return {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            first_name: employee.first_name,
            last_name: employee.last_name,
            department: employee.department,
            position: employee.position,
            email: employee.email,
            documents: [],
            document_count: 0,
            total_size: 0,
            document_types: [],
            error: error.message
          }
        }
      })
    )
    
    // Process results
    const successfulResults = []
    const failedResults = []
    
    employeesWithDocuments.forEach((result, index) => {
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
          department: department || null,
          document_type: document_type || null
        },
        statistics: {
          employees_with_documents: successfulResults.filter(emp => emp.document_count > 0).length,
          employees_without_documents: successfulResults.filter(emp => emp.document_count === 0).length,
          total_documents: successfulResults.reduce((sum, emp) => sum + emp.document_count, 0),
          total_size_bytes: successfulResults.reduce((sum, emp) => sum + emp.total_size, 0),
          failed_retrievals: failedResults.length
        }
      },
      failed_results: failedResults.length > 0 ? failedResults : undefined
    })
    
  } catch (error) {
    console.error("Error fetching bulk employee documents:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch employee documents",
      message: error.message
    })
  }
})

// GET /api/documents/bulk/simple - Get simplified list of all employees with document status
router.get("/bulk/simple", async (req, res) => {
  try {
    const db = getDatabase()
    
    // Get all employees
    const employees = await db.all(`
      SELECT uid, first_name, last_name, department
      FROM emp_list 
      ORDER BY first_name, last_name
    `)
    
    // Check document existence for each employee
    const employeesWithDocumentStatus = await Promise.allSettled(
      employees.map(async (employee) => {
        try {
          const documentsDir = path.join(process.cwd(), "uploads", employee.uid.toString(), "documents")
          
          try {
            await fs.access(documentsDir)
            const files = await fs.readdir(documentsDir)
            const allowedExtensions = [
              '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
              '.txt', '.csv', '.rtf', '.jpg', '.jpeg', '.png', '.gif', 
              '.webp', '.bmp', '.zip', '.rar'
            ]
            
            const documentFiles = files.filter(file => {
              const ext = path.extname(file).toLowerCase()
              return allowedExtensions.includes(ext)
            })
            
            return {
              uid: employee.uid,
              name: `${employee.first_name} ${employee.last_name}`,
              department: employee.department,
              has_documents: documentFiles.length > 0,
              document_count: documentFiles.length
            }
          } catch (dirError) {
            return {
              uid: employee.uid,
              name: `${employee.first_name} ${employee.last_name}`,
              department: employee.department,
              has_documents: false,
              document_count: 0
            }
          }
        } catch (error) {
          return {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            department: employee.department,
            has_documents: false,
            document_count: 0,
            error: error.message
          }
        }
      })
    )
    
    const results = employeesWithDocumentStatus
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value)
    
    const statistics = {
      total_employees: results.length,
      with_documents: results.filter(emp => emp.has_documents).length,
      without_documents: results.filter(emp => !emp.has_documents).length,
      total_document_count: results.reduce((sum, emp) => sum + emp.document_count, 0)
    }
    
    res.json({
      success: true,
      data: {
        employees: results,
        statistics: statistics
      }
    })
    
  } catch (error) {
    console.error("Error fetching simple employee documents:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch employee documents",
      message: error.message
    })
  }
})

// GET /api/documents/bulk/download - Download all documents as a ZIP file
router.get("/bulk/download", async (req, res) => {
  try {
    const db = getDatabase()
    
    // Get query parameters for filtering
    const department = req.query.department || ''
    const search = req.query.search || ''
    const document_type = req.query.document_type || ''
    const uids = req.query.uids ? req.query.uids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : []
    
    // Build query based on filters
    let whereClause = 'WHERE 1=1'
    const params = []
    
    if (uids.length > 0) {
      const placeholders = uids.map(() => '?').join(',')
      whereClause += ` AND uid IN (${placeholders})`
      params.push(...uids)
    } else {
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
    const zipFilename = `employee_documents_${timestamp}.zip`
    
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`)
    res.setHeader('Cache-Control', 'private, no-cache')
    
    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 }
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
        const documentsDir = path.join(process.cwd(), "uploads", employee.uid.toString(), "documents")
        
        // Check if documents directory exists
        await fs.access(documentsDir)
        const files = await fs.readdir(documentsDir)
        
        const allowedExtensions = [
          '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
          '.txt', '.csv', '.rtf', '.jpg', '.jpeg', '.png', '.gif', 
          '.webp', '.bmp', '.zip', '.rar'
        ]
        
        // Filter documents by type if specified
        let documentFiles = files.filter(file => {
          const ext = path.extname(file).toLowerCase()
          return allowedExtensions.includes(ext)
        })
        
        if (document_type) {
          documentFiles = documentFiles.filter(file => {
            const ext = path.extname(file).toLowerCase()
            const type = getDocumentType(ext)
            return type.toLowerCase().includes(document_type.toLowerCase())
          })
        }
        
        if (documentFiles.length > 0) {
          // Create employee folder in archive
          const employeeName = `${employee.first_name}_${employee.last_name}`.replace(/[^a-zA-Z0-9]/g, '_')
          const employeeFolder = `${employee.uid}_${employeeName}/`
          
          for (const file of documentFiles) {
            const sourcePath = path.join(documentsDir, file)
            const archiveFilename = `${employeeFolder}${file}`
            
            archive.file(sourcePath, { name: archiveFilename })
            addedCount++
          }
        } else {
          skippedCount++
          errors.push({
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            reason: "No matching document files found"
          })
        }
        
      } catch (error) {
        skippedCount++
        errors.push({
          uid: employee.uid,
          name: `${employee.first_name} ${employee.last_name}`,
          reason: error.code === 'ENOENT' ? "Documents directory not found" : error.message
        })
      }
    }
    
    // Add a summary file to the archive
    const summary = {
      generated_at: new Date().toISOString(),
      total_employees: employees.length,
      documents_included: addedCount,
      employees_skipped: skippedCount,
      filters_applied: {
        department: department || null,
        search: search || null,
        document_type: document_type || null,
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

// POST /api/documents/bulk/download - Download specific documents as ZIP (with request body)
router.post("/bulk/download", async (req, res) => {
  try {
    const { uids, document_type, include_summary = true, compression_level = 6 } = req.body
    
    if (!uids || !Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "UIDs array is required in request body"
      })
    }
    
    const validUids = uids.filter(uid => !isNaN(parseInt(uid))).map(uid => parseInt(uid))
    
    if (validUids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid UIDs provided"
      })
    }
    
    const db = getDatabase()
    
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
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const zipFilename = `employee_documents_${timestamp}.zip`
    
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`)
    res.setHeader('Cache-Control', 'private, no-cache')
    
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
    
    for (const employee of employees) {
      try {
        const documentsDir = path.join(process.cwd(), "uploads", employee.uid.toString(), "documents")
        
        await fs.access(documentsDir)
        const files = await fs.readdir(documentsDir)
        
        const allowedExtensions = [
          '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
          '.txt', '.csv', '.rtf', '.jpg', '.jpeg', '.png', '.gif', 
          '.webp', '.bmp', '.zip', '.rar'
        ]
        
        let documentFiles = files.filter(file => {
          const ext = path.extname(file).toLowerCase()
          return allowedExtensions.includes(ext)
        })
        
        if (document_type) {
          documentFiles = documentFiles.filter(file => {
            const ext = path.extname(file).toLowerCase()
            const type = getDocumentType(ext)
            return type.toLowerCase().includes(document_type.toLowerCase())
          })
        }
        
        if (documentFiles.length > 0) {
          const employeeName = `${employee.first_name}_${employee.last_name}`.replace(/[^a-zA-Z0-9]/g, '_')
          const employeeFolder = `${employee.uid}_${employeeName}/`
          
          for (const file of documentFiles) {
            const sourcePath = path.join(documentsDir, file)
            const archiveFilename = `${employeeFolder}${file}`
            
            archive.file(sourcePath, { name: archiveFilename })
            addedCount++
          }
        } else {
          skippedCount++
          errors.push({
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`,
            reason: "No matching document files found"
          })
        }
        
      } catch (error) {
        skippedCount++
        errors.push({
          uid: employee.uid,
          name: `${employee.first_name} ${employee.last_name}`,
          reason: error.code === 'ENOENT' ? "Documents directory not found" : error.message
        })
      }
    }
    
    if (include_summary) {
      const summary = {
        generated_at: new Date().toISOString(),
        requested_uids: validUids,
        total_employees_found: employees.length,
        documents_included: addedCount,
        employees_skipped: skippedCount,
        compression_level: compression_level,
        document_type_filter: document_type || null,
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

// POST /api/documents/:uid/upload - Upload document(s)
router.post("/:uid/upload", upload.array('documents', 5), async (req, res) => {
  try {
    const { uid } = req.params
    
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No files uploaded"
      })
    }

    const db = getDatabase()
    
    const employee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    const documentsDir = path.join(process.cwd(), "uploads", uid.toString(), "documents")
    
    try {
      await fs.mkdir(documentsDir, { recursive: true })
    } catch (mkdirError) {
      console.error("Error creating directory:", mkdirError)
      return res.status(500).json({
        success: false,
        error: "Failed to create upload directory"
      })
    }

    const uploadedFiles = []
    const errors = []

    // Process each uploaded file
    for (const file of req.files) {
      try {
        const timestamp = Date.now()
        const originalExtension = path.extname(file.originalname).toLowerCase()
        const baseName = path.basename(file.originalname, originalExtension)
        const filename = `${baseName}_${timestamp}${originalExtension}`
        const filePath = path.join(documentsDir, filename)

        await fs.writeFile(filePath, file.buffer)
        const stats = await fs.stat(filePath)
        
        uploadedFiles.push({
          filename: filename,
          originalName: file.originalname,
          size: stats.size,
          mimetype: file.mimetype,
          type: getDocumentType(originalExtension),
          url: `/api/documents/${uid}/${filename}`,
          uploadedAt: new Date().toISOString()
        })
        
      } catch (fileError) {
        errors.push({
          filename: file.originalname,
          error: fileError.message
        })
      }
    }
    
    const statusCode = errors.length === 0 ? 201 : (uploadedFiles.length > 0 ? 207 : 500)
    
    res.status(statusCode).json({
      success: uploadedFiles.length > 0,
      message: errors.length === 0 ? 
        "Documents uploaded successfully" : 
        `${uploadedFiles.length} documents uploaded successfully, ${errors.length} failed`,
      data: {
        employee: {
          uid: employee.uid,
          name: `${employee.first_name} ${employee.last_name}`
        },
        uploaded_files: uploadedFiles,
        failed_files: errors.length > 0 ? errors : undefined,
        directory: documentsDir
      }
    })
    
  } catch (error) {
    console.error("Error uploading documents:", error)
    res.status(500).json({
      success: false,
      error: "Failed to upload documents",
      message: error.message
    })
  }
})

// GET /api/documents/:uid - Get employee document list
router.get("/:uid", async (req, res) => {
  try {
    const { uid } = req.params
    
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }

    const db = getDatabase()
    
    const employee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    const documents = await getEmployeeDocumentInfo(employee.uid)
    
    res.json({
      success: true,
      data: {
        employee: {
          uid: employee.uid,
          name: `${employee.first_name} ${employee.last_name}`
        },
        documents: documents,
        document_count: documents.length,
        total_size: documents.reduce((sum, doc) => sum + doc.size, 0),
        document_types: [...new Set(documents.map(doc => doc.type))]
      }
    })
    
  } catch (error) {
    console.error("Error retrieving employee documents:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve employee documents",
      message: error.message
    })
  }
})

// GET /api/documents/:uid/:filename - Get specific document file
router.get("/:uid/:filename", async (req, res) => {
  try {
    const { uid, filename } = req.params
    
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
    
    const employee = await db.get("SELECT uid FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    const documentPath = path.join(process.cwd(), "uploads", uid.toString(), "documents", filename)
    
    try {
      const stats = await fs.stat(documentPath)
      
      // Validate file extension
      const ext = path.extname(filename).toLowerCase()
      const allowedExtensions = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.txt', '.csv', '.rtf', '.jpg', '.jpeg', '.png', '.gif', 
        '.webp', '.bmp', '.zip', '.rar'
      ]
      
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({
          success: false,
          error: "Invalid document file type"
        })
      }
      
      // Set appropriate content type based on file extension
      const contentTypes = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.rtf': 'application/rtf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.zip': 'application/zip',
        '.rar': 'application/x-rar-compressed'
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
      const fileBuffer = await fs.readFile(documentPath)
      res.send(fileBuffer)
      
    } catch (fileError) {
      if (fileError.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          error: "Document file not found"
        })
      }
      throw fileError
    }
    
  } catch (error) {
    console.error("Error retrieving specific document:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve document",
      message: error.message
    })
  }
})

// GET /api/documents/:uid/:filename/download - Download specific document with proper headers
router.get("/:uid/:filename/download", async (req, res) => {
  try {
    const { uid, filename } = req.params
    
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
    
    const employee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    const documentPath = path.join(process.cwd(), "uploads", uid.toString(), "documents", filename)
    
    try {
      const stats = await fs.stat(documentPath)
      
      // Validate file extension
      const ext = path.extname(filename).toLowerCase()
      const allowedExtensions = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.txt', '.csv', '.rtf', '.jpg', '.jpeg', '.png', '.gif', 
        '.webp', '.bmp', '.zip', '.rar'
      ]
      
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({
          success: false,
          error: "Invalid document file type"
        })
      }
      
      // Set content type
      const contentTypes = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.rtf': 'application/rtf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.zip': 'application/zip',
        '.rar': 'application/x-rar-compressed'
      }
      
      const contentType = contentTypes[ext] || 'application/octet-stream'
      
      // Set headers for download
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Length', stats.size)
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Cache-Control', 'private, no-cache')
      
      // Stream the file
      const fileBuffer = await fs.readFile(documentPath)
      res.send(fileBuffer)
      
    } catch (fileError) {
      if (fileError.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          error: "Document file not found"
        })
      }
      throw fileError
    }
    
  } catch (error) {
    console.error("Error downloading document:", error)
    res.status(500).json({
      success: false,
      error: "Failed to download document",
      message: error.message
    })
  }
})

// DELETE /api/documents/:uid/:filename - Delete specific document
router.delete("/:uid/:filename", async (req, res) => {
  try {
    const { uid, filename } = req.params
    
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
    
    const employee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    const documentPath = path.join(process.cwd(), "uploads", uid.toString(), "documents", filename)
    
    try {
      // Check if file exists
      await fs.access(documentPath)
      
      // Get file info before deletion
      const stats = await fs.stat(documentPath)
      const ext = path.extname(filename).toLowerCase()
      
      // Delete the file
      await fs.unlink(documentPath)
      
      res.json({
        success: true,
        message: "Document deleted successfully",
        data: {
          employee: {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`
          },
          deleted_file: {
            filename: filename,
            size: stats.size,
            type: getDocumentType(ext)
          }
        }
      })
      
    } catch (fileError) {
      if (fileError.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          error: "Document file not found"
        })
      }
      throw fileError
    }
    
  } catch (error) {
    console.error("Error deleting document:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete document",
      message: error.message
    })
  }
})

// DELETE /api/documents/:uid - Delete all documents for an employee
router.delete("/:uid", async (req, res) => {
  try {
    const { uid } = req.params
    
    if (!uid || isNaN(uid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee UID"
      })
    }

    const db = getDatabase()
    
    const employee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [uid])
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      })
    }

    const documentsDir = path.join(process.cwd(), "uploads", uid.toString(), "documents")
    
    try {
      // Check if documents directory exists
      await fs.access(documentsDir)
      
      // Read directory contents
      const files = await fs.readdir(documentsDir)
      
      const allowedExtensions = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.txt', '.csv', '.rtf', '.jpg', '.jpeg', '.png', '.gif', 
        '.webp', '.bmp', '.zip', '.rar'
      ]
      
      const documentFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase()
        return allowedExtensions.includes(ext)
      })

      if (documentFiles.length === 0) {
        return res.json({
          success: true,
          message: "No documents found to delete",
          data: {
            employee: {
              uid: employee.uid,
              name: `${employee.first_name} ${employee.last_name}`
            },
            deleted_count: 0
          }
        })
      }

      // Delete all document files
      const deletedFiles = []
      const errors = []

      for (const file of documentFiles) {
        try {
          const filePath = path.join(documentsDir, file)
          const stats = await fs.stat(filePath)
          await fs.unlink(filePath)
          
          deletedFiles.push({
            filename: file,
            size: stats.size,
            type: getDocumentType(path.extname(file).toLowerCase())
          })
        } catch (deleteError) {
          errors.push({
            filename: file,
            error: deleteError.message
          })
        }
      }
      
      res.json({
        success: true,
        message: `${deletedFiles.length} documents deleted successfully`,
        data: {
          employee: {
            uid: employee.uid,
            name: `${employee.first_name} ${employee.last_name}`
          },
          deleted_files: deletedFiles,
          deleted_count: deletedFiles.length,
          failed_deletions: errors.length > 0 ? errors : undefined
        }
      })
      
    } catch (dirError) {
      if (dirError.code === 'ENOENT') {
        return res.json({
          success: true,
          message: "No documents directory found",
          data: {
            employee: {
              uid: employee.uid,
              name: `${employee.first_name} ${employee.last_name}`
            },
            deleted_count: 0
          }
        })
      }
      throw dirError
    }
    
  } catch (error) {
    console.error("Error deleting all documents:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete documents",
      message: error.message
    })
  }
})

// GET /api/documents/stats/overview - Get document statistics overview
router.get("/stats/overview", async (req, res) => {
  try {
    const db = getDatabase()
    
    // Get all employees
    const employees = await db.all(`
      SELECT uid, first_name, last_name, department
      FROM emp_list 
      ORDER BY first_name, last_name
    `)
    
    let totalDocuments = 0
    let totalSize = 0
    let employeesWithDocs = 0
    const departmentStats = {}
    const typeStats = {}
    
    // Process each employee
    for (const employee of employees) {
      try {
        const documents = await getEmployeeDocumentInfo(employee.uid)
        
        if (documents.length > 0) {
          employeesWithDocs++
          totalDocuments += documents.length
          
          // Calculate department stats
          if (!departmentStats[employee.department]) {
            departmentStats[employee.department] = {
              employees: 0,
              documents: 0,
              size: 0
            }
          }
          departmentStats[employee.department].employees++
          departmentStats[employee.department].documents += documents.length
          
          // Process each document
          for (const doc of documents) {
            totalSize += doc.size
            departmentStats[employee.department].size += doc.size
            
            // Track document types
            if (!typeStats[doc.type]) {
              typeStats[doc.type] = {
                count: 0,
                size: 0
              }
            }
            typeStats[doc.type].count++
            typeStats[doc.type].size += doc.size
          }
        }
      } catch (error) {
        console.warn(`Error processing documents for employee ${employee.uid}:`, error.message)
      }
    }
    
    res.json({
      success: true,
      data: {
        overview: {
          total_employees: employees.length,
          employees_with_documents: employeesWithDocs,
          employees_without_documents: employees.length - employeesWithDocs,
          total_documents: totalDocuments,
          total_size_bytes: totalSize,
          total_size_mb: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
          average_documents_per_employee: Math.round((totalDocuments / employees.length) * 100) / 100
        },
        department_breakdown: departmentStats,
        document_type_breakdown: typeStats,
        generated_at: new Date().toISOString()
      }
    })
    
  } catch (error) {
    console.error("Error generating document statistics:", error)
    res.status(500).json({
      success: false,
      error: "Failed to generate document statistics",
      message: error.message
    })
  }
})

module.exports = router



// Bulk Operations:

// GET /api/documents/bulk - Get all employees with their documents (with pagination and filtering)
// GET /api/documents/bulk/simple - Get simplified document status for all employees
// GET /api/documents/bulk/download - Download all documents as ZIP file
// POST /api/documents/bulk/download - Download specific documents as ZIP (with request body)

// Individual Employee Operations:

// POST /api/documents/:uid/upload - Upload multiple documents (up to 5 files, 50MB limit)
// GET /api/documents/:uid - Get document list for specific employee
// GET /api/documents/:uid/:filename - View/access specific document
// GET /api/documents/:uid/:filename/download - Download specific document
// DELETE /api/documents/:uid/:filename - Delete specific document
// DELETE /api/documents/:uid - Delete all documents for an employee

// Statistics:

// GET /api/documents/stats/overview - Get comprehensive document statistics