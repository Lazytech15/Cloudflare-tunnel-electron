
// Add this environment variable check at the top of your file
const USE_PRODUCTION_BUILD = process.env.USE_PRODUCTION_BUILD === 'true' || 
                            process.env.NODE_ENV === 'production' ||
                            process.argv.includes('--production') ||
                            process.argv.includes('--prod')

process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('util._extend')) {
    return; // Ignore this specific warning
  }
  console.warn(warning.message);
});

// Better approach for production module resolution
const path = require("path")
const { spawn } = require("child_process")
const fs = require("fs")
const net = require('net');
const bcrypt = require('bcrypt');

// Determine if we're in development or production
const isDev = process.env.NODE_ENV === "development" || process.defaultApp

if (!isDev && process.env.NODE_PATH) {
  // In production, ensure module paths are set up correctly
  const Module = require("module")

  // Get the original require function
  const originalRequire = Module.prototype.require

  // Override require to handle production paths
  Module.prototype.require = function (id) {
    try {
      return originalRequire.apply(this, arguments)
    } catch (err) {
      if (err.code === "MODULE_NOT_FOUND" && process.env.NODE_PATH) {
        // Try to resolve from NODE_PATH
        const altPath = path.join(process.env.NODE_PATH, id)
        try {
          return originalRequire.call(this, altPath)
        } catch (err2) {
          // If still not found, throw original error
          throw err
        }
      }
      throw err
    }
  }
}


const express = require("express")
const sqlite3 = require("sqlite3")
const { open } = require("sqlite")
const cors = require("cors")
const { createProxyMiddleware } = require("http-proxy-middleware")

const app = express()
const PORT = process.env.PORT || 3001
const VITE_PORT = 5173

let viteProcess = null

// Function to find npm executable and get proper spawn options
function getNpmSpawnConfig() {
  const isWindows = process.platform === "win32"
  
  if (isWindows) {
    // On Windows, we need to use shell: true or cmd /c
    // Try different approaches
    const npmCommands = ['npm.cmd', 'npm.exe', 'npm']
    
    for (const npmCmd of npmCommands) {
      try {
        const { execSync } = require("child_process")
        execSync(`${npmCmd} --version`, { stdio: 'ignore' })
        return {
          command: npmCmd,
          options: { shell: true }
        }
      } catch (error) {
        // Continue to next option
      }
    }
    
    // Try with cmd /c approach
    try {
      const { execSync } = require("child_process")
      execSync('npm --version', { stdio: 'ignore' })
      return {
        command: 'cmd',
        args: ['/c', 'npm'],
        options: {}
      }
    } catch (error) {
      // Continue
    }
    
    // Try common installation paths
    const commonPaths = [
      path.join(process.env.APPDATA || '', 'npm', 'npm.cmd'),
      path.join(process.env.PROGRAMFILES || '', 'nodejs', 'npm.cmd'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'nodejs', 'npm.cmd'),
      'C:\\Program Files\\nodejs\\npm.cmd',
      'C:\\Program Files (x86)\\nodejs\\npm.cmd'
    ]
    
    for (const npmPath of commonPaths) {
      if (fs.existsSync(npmPath)) {
        return {
          command: npmPath,
          options: {}
        }
      }
    }
  } else {
    // Unix-like systems
    try {
      const { execSync } = require("child_process")
      execSync('npm --version', { stdio: 'ignore' })
      return {
        command: 'npm',
        options: {}
      }
    } catch (error) {
      // npm not found
    }
  }
  
  return null
}

async function startViteServer() {
  return new Promise((resolve, reject) => {
    // Check if we should use production build instead of dev server
    if (USE_PRODUCTION_BUILD) {
      console.log("🏗️ Using production build instead of Vite dev server...")
      
      const distPath = path.join(__dirname, "..", "web-app", "dist")
      if (fs.existsSync(distPath)) {
        console.log(`✅ Production build found at: ${distPath}`)
        console.log("📦 Serving optimized static files")
      } else {
        console.log(`⚠️ Production build not found at: ${distPath}`)
        console.log("💡 Run 'npm run build' in the web-app directory to create a production build")
        console.log("🔄 Alternatively, remove USE_PRODUCTION_BUILD=true to use dev server")
      }
      
      resolve()
      return
    }

    console.log("🚀 Starting React Vite development server...")

    // Get the web-app directory path
    const webAppDir = path.join(__dirname, "..", "web-app")
    console.log(`📁 Vite project directory: ${webAppDir}`)

    // Check if web-app directory exists
    if (!fs.existsSync(webAppDir)) {
      const error = new Error(`Web app directory not found at: ${webAppDir}`)
      console.error("❌", error.message)
      console.log("⚠️ Continuing without Vite server - serving static files only")
      resolve()
      return
    }

    // Check if package.json exists
    const packageJsonPath = path.join(webAppDir, "package.json")
    if (!fs.existsSync(packageJsonPath)) {
      console.log("⚠️ No package.json found in web-app directory, skipping Vite server")
      resolve()
      return
    }

    // Get npm spawn configuration
    const npmConfig = getNpmSpawnConfig()
    if (!npmConfig) {
      console.log("⚠️ npm not found in PATH or common locations")
      console.log("💡 Trying alternative approaches...")
      
      // Try using node directly to run vite
      const viteScript = path.join(webAppDir, "node_modules", ".bin", "vite")
      const viteScriptJs = path.join(webAppDir, "node_modules", ".bin", "vite.js")
      
      if (fs.existsSync(viteScript)) {
        console.log("🔧 Found local vite installation, trying direct execution...")
        viteProcess = spawn("node", [viteScript], {
          cwd: webAppDir,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PORT: VITE_PORT.toString(),
            HOST: "0.0.0.0",
          },
        })
      } else if (fs.existsSync(viteScriptJs)) {
        console.log("🔧 Found local vite.js, trying direct execution...")
        viteProcess = spawn("node", [viteScriptJs], {
          cwd: webAppDir,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PORT: VITE_PORT.toString(),
            HOST: "0.0.0.0",
          },
        })
      } else {
        console.log("⚠️ Cannot start Vite server - npm and vite not found")
        console.log("💡 Consider running 'npm install' in the web-app directory first")
        resolve()
        return
      }
    } else {
      console.log(`✅ Found npm configuration: ${npmConfig.command}`)
      
      // Start Vite dev server using found npm configuration
      const spawnArgs = npmConfig.args ? [...npmConfig.args, "run", "dev"] : ["run", "dev"]
      const spawnOptions = {
        cwd: webAppDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PORT: VITE_PORT.toString(),
          HOST: "0.0.0.0",
        },
        ...npmConfig.options
      }
      
      console.log(`🔧 Spawning: ${npmConfig.command} ${spawnArgs.join(' ')}`)
      viteProcess = spawn(npmConfig.command, spawnArgs, spawnOptions)
    }

    if (!viteProcess) {
      console.log("⚠️ Could not start Vite process")
      resolve()
      return
    }

    let serverStarted = false

    viteProcess.stdout.on("data", (data) => {
      const output = data.toString()
      console.log("[VITE]:", output)

      // Check if Vite server is ready
      if ((output.includes("Local:") || output.includes("ready in")) && !serverStarted) {
        serverStarted = true
        console.log(`✅ Vite server started on port ${VITE_PORT}`)
        resolve()
      }
    })

    viteProcess.stderr.on("data", (data) => {
      const output = data.toString()
      console.log("[VITE ERROR]:", output)
    })

    viteProcess.on("error", (error) => {
      console.error("❌ Vite process error:", error)
      console.log("⚠️ Continuing without Vite server")
      viteProcess = null
      resolve() // Don't reject, continue without Vite
    })

    viteProcess.on("exit", (code, signal) => {
      console.log(`Vite process exited with code ${code} and signal ${signal}`)
      viteProcess = null
    })

    // Timeout fallback
    setTimeout(() => {
      if (!serverStarted) {
        console.log("⏰ Vite server start timeout, continuing anyway...")
        resolve()
      }
    }, 30000) // 30 second timeout for Vite to start
  })
}

// Middleware
app.use(cors())
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

// Database setup
let db

async function initDatabase() {
  try {
    // Use DATABASE_DIR environment variable if provided (from main process)
    // Otherwise use current working directory
    const databaseDir = process.env.DATABASE_DIR || process.cwd()
    const dbPath = path.join(databaseDir, "database.db")

    console.log(`📂 Database directory: ${databaseDir}`)
    console.log(`📄 Database path: ${dbPath}`)
    console.log(`🔧 Current working directory: ${process.cwd()}`)
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`)

    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    console.log("✅ Connected to SQLite database")

    // Create a sample table if it doesn't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sample_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Insert sample data if table is empty
    const count = await db.get("SELECT COUNT(*) as count FROM sample_data")
    if (count.count === 0) {
      await db.run(`INSERT INTO sample_data (name, value) VALUES 
        ('Sample Entry 1', 'This is a test value'),
        ('Sample Entry 2', 'Another test value'),
        ('Sample Entry 3', 'Third test value')
      `)
      console.log("📝 Inserted sample data")
    }

    console.log("🚀 Database initialized successfully")
    console.log(`📊 Database location: ${dbPath}`)
  } catch (error) {
    console.error("❌ Database initialization error:", error)
    console.error("Stack trace:", error.stack)
    throw error
  }
}

// API Routes

//auth access
app.get("/api/auth", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: "Database not initialized" 
      });
    }

    const { username, password, department } = req.query;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Username and password are required" 
      });
    }

    if (!department) {
      return res.status(400).json({ 
        success: false, 
        error: "Department is required" 
      });
    }

    // Define valid departments (should match your frontend departmentInfo keys)
    const validDepartments = [
      'Human Resources', 
      'Operation', 
      'Finance', 
      'Procurement', 
      'Engineering', 
      'super-admin'
    ];

    if (!validDepartments.includes(department)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid department" 
      });
    }

    // Fetch user by username and department
    let query = `SELECT * FROM emp_list WHERE username = ?`;
    let params = [username];

    // If not super-admin, also check department
    if (department !== 'super-admin') {
      query += ` AND department = ?`;
      params.push(department);
    }

    const user = await db.get(query, params);

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found or not authorized for this department" 
      });
    }

    // Compare hashed password
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid credentials" 
      });
    }

    // Determine user role and permissions based on access_level and department
    let role = 'user';
    let permissions = ['read'];

    if (department === 'super-admin' && user.access_level >= 10) {
      role = 'super-admin';
      permissions = ['read', 'write', 'delete', 'admin', 'manage-all'];
    } else if (user.access_level >= 8) {
      role = 'admin';
      permissions = ['read', 'write', 'delete', 'admin'];
    } else if (user.access_level >= 5) {
      role = 'manager';
      permissions = ['read', 'write', 'delete'];
    } else if (user.access_level >= 3) {
      role = 'editor';
      permissions = ['read', 'write'];
    }

    // Return success response with user info (excluding sensitive fields)
    const { uid, first_name, last_name, access_level, department: userDept } = user;
    
    res.json({ 
      success: true,
      user: {
        id: uid,
        name: `${first_name} ${last_name}`.trim(),
        username: username,
        access_level: access_level,
        department: userDept,
        role: role,
        permissions: permissions
      }
    });

  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    database: db ? "connected" : "disconnected",
    viteServer: viteProcess ? "running" : "not running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    databaseDir: process.env.DATABASE_DIR || process.cwd(),
    processInfo: {
      pid: process.pid,
      cwd: process.cwd(),
      execPath: process.execPath,
      platform: process.platform,
    },
  })
})

//Get all Employees
// GET API endpoint for Employee Records
app.get("/api/employees", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { 
      limit = 100, 
      offset = 0, 
      search = '', 
      department = '', 
      status = 'Active',
      sortBy = 'hire_date',
      sortOrder = 'DESC'
    } = req.query;

    // Validate and sanitize parameters
    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 100), 1000);
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0);
    
    // Validate sort parameters
    const allowedSortFields = ['last_name', 'first_name', 'hire_date', 'position', 'salary', 'age'];
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'hire_date';
    const validSortOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

    // Build WHERE clause
    let whereConditions = [];
    let params = [];

    // Search functionality
    if (search) {
      whereConditions.push(`(
        LOWER(first_name || ' ' || COALESCE(middle_name, '') || ' ' || last_name) LIKE LOWER(?) OR
        LOWER(position) LIKE LOWER(?) OR
        LOWER(department) LIKE LOWER(?) OR
        LOWER(email) LIKE LOWER(?)
      )`);
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Filter by department
    if (department) {
      whereConditions.push('LOWER(department) = LOWER(?)');
      params.push(department);
    }

    // Filter by status
    if (status) {
      whereConditions.push('LOWER(status) = LOWER(?)');
      params.push(status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

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
        created_at,
        CASE 
          WHEN hire_date >= date('now', '-30 days') THEN 1 
          ELSE 0 
        END as is_new_hire
      FROM emp_list
      ${whereClause}
      ORDER BY ${validSortBy} ${validSortOrder}
      LIMIT ? OFFSET ?
    `;

    const employees = await db.all(employeeQuery, [...params, parsedLimit, parsedOffset]);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM emp_list
      ${whereClause}
    `;
    const totalResult = await db.get(countQuery, params);

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
    `;
    const stats = await db.get(statsQuery, params);

    // Get department breakdown
    const departmentQuery = `
      SELECT 
        department,
        COUNT(*) as count,
        COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_count
      FROM emp_list
      ${whereClause.replace('LOWER(department) = LOWER(?)', '1=1')} -- Remove department filter for breakdown
      GROUP BY department
      ORDER BY count DESC
    `;
    const departments = await db.all(departmentQuery, params.filter((_, index) => {
      // Remove department parameter if it was used in the filter
      return !(department && whereConditions.includes('LOWER(department) = LOWER(?)') && 
               params.indexOf(department) === index);
    }));

    // Format the response
    const formattedEmployees = employees.map(emp => ({
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
      createdAt: emp.created_at,
      isNewHire: emp.is_new_hire === 1
    }));

    res.json({
      success: true,
      data: {
        employees: formattedEmployees,
        pagination: {
          total: totalResult.total,
          limit: parsedLimit,
          offset: parsedOffset,
          pages: Math.ceil(totalResult.total / parsedLimit),
          currentPage: Math.floor(parsedOffset / parsedLimit) + 1
        },
        statistics: {
          totalEmployees: stats.total_employees,
          activeEmployees: stats.active_employees,
          inactiveEmployees: stats.inactive_employees,
          newHiresLast30Days: stats.new_hires_last_30_days,
          employeesWithoutDepartment: stats.employees_without_department,
          averageSalary: stats.average_salary ? `₱${Number(stats.average_salary).toLocaleString()}` : null,
          totalDepartments: stats.total_departments
        },
        departments: departments.map(dept => ({
          name: dept.department || 'Unassigned',
          totalCount: dept.count,
          activeCount: dept.active_count
        }))
      }
    });

  } catch (error) {
    console.error("Error fetching employee records:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch employee records",
      message: error.message 
    });
  }
});

// GET single employee by ID
app.get("/api/employees/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { id } = req.params;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid employee ID" 
      });
    }

    const employee = await db.get(`
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
        created_at
      FROM emp_list
      WHERE uid = ?
    `, [id]);

    if (!employee) {
      return res.status(404).json({ 
        success: false,
        error: "Employee not found" 
      });
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
      createdAt: employee.created_at
    };

    res.json({
      success: true,
      data: formattedEmployee
    });

  } catch (error) {
    console.error("Error fetching employee:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch employee",
      message: error.message 
    });
  }
});

// PUT update employee by ID
app.put("/api/employees/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { id } = req.params;
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
      hireDate,
      idNumber,
      idBarcode,
      tinNumber,
      sssNumber,
      pagibigNumber,
      philhealthNumber,
      status,
      salary
    } = req.body;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid employee ID" 
      });
    }

    // Check if employee exists
    const existingEmployee = await db.get("SELECT uid FROM emp_list WHERE uid = ?", [id]);
    if (!existingEmployee) {
      return res.status(404).json({ 
        success: false,
        error: "Employee not found" 
      });
    }

    // Validate required fields
    if (!firstName || !lastName) {
      return res.status(400).json({ 
        success: false,
        error: "First name and last name are required" 
      });
    }

    // Check for duplicate employee ID (excluding current employee)
    if (idNumber) {
      const duplicateId = await db.get(
        "SELECT uid FROM emp_list WHERE id_number = ? AND uid != ?", 
        [idNumber, id]
      );
      if (duplicateId) {
        return res.status(400).json({ 
          success: false,
          error: "Employee ID number already exists" 
        });
      }
    }

    // Update employee record
    const updateQuery = `
      UPDATE emp_list SET
        first_name = ?,
        middle_name = ?,
        last_name = ?,
        age = ?,
        birth_date = ?,
        contact_number = ?,
        email = ?,
        civil_status = ?,
        address = ?,
        position = ?,
        department = ?,
        hire_date = ?,
        id_number = ?,
        id_barcode = ?,
        tin_number = ?,
        sss_number = ?,
        pagibig_number = ?,
        philhealth_number = ?,
        status = ?,
        salary = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE uid = ?
    `;

    const result = await db.run(updateQuery, [
      firstName?.trim(),
      middleName?.trim() || null,
      lastName?.trim(),
      age ? parseInt(age) : null,
      birthDate || null,
      contactNumber?.trim() || null,
      email?.trim() || null,
      civilStatus?.trim() || null,
      address?.trim() || null,
      position?.trim() || null,
      department?.trim() || null,
      hireDate || null,
      idNumber?.trim() || null,
      idBarcode?.trim() || null,
      tinNumber?.trim() || null,
      sssNumber?.trim() || null,
      pagibigNumber?.trim() || null,
      philhealthNumber?.trim() || null,
      status?.trim() || 'Active',
      salary?.trim() || null,
      id
    ]);

    if (result.changes === 0) {
      return res.status(404).json({ 
        success: false,
        error: "Employee not found or no changes made" 
      });
    }

    // Fetch updated employee data
    const updatedEmployee = await db.get(`
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
        created_at,
        updated_at
      FROM emp_list
      WHERE uid = ?
    `, [id]);

    const formattedEmployee = {
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
      idNumber: updatedEmployee.id_number,
      idBarcode: updatedEmployee.id_barcode,
      tinNumber: updatedEmployee.tin_number,
      sssNumber: updatedEmployee.sss_number,
      pagibigNumber: updatedEmployee.pagibig_number,
      philhealthNumber: updatedEmployee.philhealth_number,
      status: updatedEmployee.status,
      salary: updatedEmployee.salary,
      createdAt: updatedEmployee.created_at,
      updatedAt: updatedEmployee.updated_at
    };

    res.json({
      success: true,
      message: "Employee updated successfully",
      data: formattedEmployee
    });

  } catch (error) {
    console.error("Error updating employee:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to update employee",
      message: error.message 
    });
  }
});

// DELETE employee by ID
app.delete("/api/employees/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { id } = req.params;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid employee ID" 
      });
    }

    // Check if employee exists and get their info for confirmation
    const employee = await db.get(
      "SELECT uid, first_name, last_name, id_number, position, department FROM emp_list WHERE uid = ?", 
      [id]
    );

    if (!employee) {
      return res.status(404).json({ 
        success: false,
        error: "Employee not found" 
      });
    }

    // Before deleting, you might want to check if the employee has related records
    // in other tables (like attendance, payroll, etc.) and handle them appropriately
    // For now, we'll just delete the employee record

    // Perform the deletion
    const result = await db.run("DELETE FROM emp_list WHERE uid = ?", [id]);

    if (result.changes === 0) {
      return res.status(404).json({ 
        success: false,
        error: "Employee not found or already deleted" 
      });
    }

    res.json({
      success: true,
      message: `Employee ${employee.first_name} ${employee.last_name} (ID: ${employee.id_number}) has been successfully deleted`,
      data: {
        deletedEmployee: {
          id: employee.uid,
          name: `${employee.first_name} ${employee.last_name}`,
          idNumber: employee.id_number,
          position: employee.position,
          department: employee.department
        }
      }
    });

  } catch (error) {
    console.error("Error deleting employee:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to delete employee",
      message: error.message 
    });
  }
});

// PATCH update employee status (for quick status changes)
app.patch("/api/employees/:id/status", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { id } = req.params;
    const { status } = req.body;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid employee ID" 
      });
    }

    // Validate status
    const validStatuses = ['Active', 'Inactive', 'On Leave', 'Terminated'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(', ')
      });
    }

    // Check if employee exists
    const existingEmployee = await db.get("SELECT uid, first_name, last_name FROM emp_list WHERE uid = ?", [id]);
    if (!existingEmployee) {
      return res.status(404).json({ 
        success: false,
        error: "Employee not found" 
      });
    }

    // Update employee status
    const result = await db.run(
      "UPDATE emp_list SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?", 
      [status, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ 
        success: false,
        error: "Employee not found or no changes made" 
      });
    }

    res.json({
      success: true,
      message: `Employee status updated to ${status}`,
      data: {
        id: parseInt(id),
        name: `${existingEmployee.first_name} ${existingEmployee.last_name}`,
        newStatus: status
      }
    });

  } catch (error) {
    console.error("Error updating employee status:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to update employee status",
      message: error.message 
    });
  }
});

// Bulk delete employees (optional - for multiple selections)
app.delete("/api/employees/bulk", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { employeeIds } = req.body;

    // Validate input
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "Employee IDs array is required and cannot be empty" 
      });
    }

    // Validate all IDs are numbers
    const invalidIds = employeeIds.filter(id => !id || isNaN(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: "All employee IDs must be valid numbers" 
      });
    }

    // Get employee info before deletion for confirmation
    const placeholders = employeeIds.map(() => '?').join(',');
    const employees = await db.all(
      `SELECT uid, first_name, last_name, id_number FROM emp_list WHERE uid IN (${placeholders})`, 
      employeeIds
    );

    if (employees.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: "No employees found with the provided IDs" 
      });
    }

    // Perform bulk deletion
    const result = await db.run(
      `DELETE FROM emp_list WHERE uid IN (${placeholders})`, 
      employeeIds
    );

    res.json({
      success: true,
      message: `Successfully deleted ${result.changes} employee(s)`,
      data: {
        deletedCount: result.changes,
        deletedEmployees: employees.map(emp => ({
          id: emp.uid,
          name: `${emp.first_name} ${emp.last_name}`,
          idNumber: emp.id_number
        }))
      }
    });

  } catch (error) {
    console.error("Error bulk deleting employees:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to delete employees",
      message: error.message 
    });
  }
});

// Additional helper endpoint to check if employee ID exists (for validation)
app.get("/api/employees/check-id/:idNumber", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { idNumber } = req.params;
    const { excludeUid } = req.query; // To exclude current employee when editing

    if (!idNumber) {
      return res.status(400).json({ 
        success: false,
        error: "Employee ID number is required" 
      });
    }

    let query = "SELECT uid, first_name, last_name FROM emp_list WHERE id_number = ?";
    let params = [idNumber];

    if (excludeUid) {
      query += " AND uid != ?";
      params.push(excludeUid);
    }

    const employee = await db.get(query, params);

    res.json({
      success: true,
      exists: !!employee,
      data: employee ? {
        id: employee.uid,
        name: `${employee.first_name} ${employee.last_name}`,
        idNumber: idNumber
      } : null
    });

  } catch (error) {
    console.error("Error checking employee ID:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to check employee ID",
      message: error.message 
    });
  }
});

// Get employee audit log/history (if you have an audit table)
app.get("/api/employees/:id/history", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid employee ID" 
      });
    }

    // This assumes you have an audit/history table
    // If you don't have one, you might want to create it to track changes
    const historyQuery = `
      SELECT 
        action_type,
        changed_fields,
        old_values,
        new_values,
        changed_by,
        changed_at
      FROM emp_audit_log 
      WHERE employee_uid = ? 
      ORDER BY changed_at DESC
      LIMIT 50
    `;

    try {
      const history = await db.all(historyQuery, [id]);
      
      res.json({
        success: true,
        data: history
      });
    } catch (tableError) {
      // If audit table doesn't exist, return empty history
      if (tableError.message.includes('no such table')) {
        res.json({
          success: true,
          data: [],
          message: "Audit logging is not enabled"
        });
      } else {
        throw tableError;
      }
    }

  } catch (error) {
    console.error("Error fetching employee history:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch employee history",
      message: error.message 
    });
  }
});

// Export employee data (CSV format)
app.get("/api/employees/export", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { format = 'json', department, status } = req.query;

    // Build WHERE clause for filtering
    let whereConditions = [];
    let params = [];

    if (department) {
      whereConditions.push('LOWER(department) = LOWER(?)');
      params.push(department);
    }

    if (status) {
      whereConditions.push('LOWER(status) = LOWER(?)');
      params.push(status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const employees = await db.all(`
      SELECT 
        uid as id,
        first_name,
        middle_name,
        last_name,
        (first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name) as full_name,
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
        created_at
      FROM emp_list
      ${whereClause}
      ORDER BY last_name, first_name
    `, params);

    if (format === 'csv') {
      // Generate CSV
      const csvHeaders = [
        'ID', 'First Name', 'Middle Name', 'Last Name', 'Full Name', 'Age', 'Birth Date',
        'Contact Number', 'Email', 'Civil Status', 'Address', 'Hire Date', 'Position',
        'Department', 'Employee ID', 'ID Barcode', 'TIN Number', 'SSS Number',
        'Pag-IBIG Number', 'PhilHealth Number', 'Status', 'Salary', 'Created At'
      ].join(',');

      const csvRows = employees.map(emp => [
        emp.id,
        `"${emp.first_name || ''}"`,
        `"${emp.middle_name || ''}"`,
        `"${emp.last_name || ''}"`,
        `"${emp.full_name || ''}"`,
        emp.age || '',
        emp.birth_date || '',
        `"${emp.contact_number || ''}"`,
        `"${emp.email || ''}"`,
        `"${emp.civil_status || ''}"`,
        `"${emp.address || ''}"`,
        emp.hire_date || '',
        `"${emp.position || ''}"`,
        `"${emp.department || ''}"`,
        `"${emp.id_number || ''}"`,
        `"${emp.id_barcode || ''}"`,
        `"${emp.tin_number || ''}"`,
        `"${emp.sss_number || ''}"`,
        `"${emp.pagibig_number || ''}"`,
        `"${emp.philhealth_number || ''}"`,
        `"${emp.status || ''}"`,
        `"${emp.salary || ''}"`,
        emp.created_at || ''
      ].join(','));

      const csvContent = [csvHeaders, ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="employees_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvContent);
    } else {
      // Return JSON
      res.json({
        success: true,
        data: employees,
        count: employees.length,
        exportedAt: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error("Error exporting employees:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to export employee data",
      message: error.message 
    });
  }
});

//Add new Employee
app.post("/api/employees", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ 
        success: false,
        error: "Database not initialized" 
      });
    }

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
      status = 'Active',
      employeeId, // This will be mapped to id_number
      idBarcode, // Manual input for id_barcode
      // Government IDs (optional for new employees)
      tinNumber,
      sssNumber,
      pagibigNumber,
      philhealthNumber,
      // System fields
      username,
      accessLevel = 'user'
    } = req.body;

    console.log('Adding new employee:', { firstName, lastName, position, department, employeeId, idBarcode }); // Debug log

    // Validation - required fields
    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: "First name and last name are required"
      });
    }

    if (!email || !position || !department) {
      return res.status(400).json({
        success: false,
        error: "Email, position, and department are required"
      });
    }

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        error: "Employee ID is required"
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid email address"
      });
    }

    // Check if email already exists
    const existingEmployee = await db.get(
      'SELECT uid, email FROM emp_list WHERE LOWER(email) = LOWER(?)', 
      [email]
    );

    if (existingEmployee) {
      return res.status(400).json({
        success: false,
        error: "An employee with this email address already exists"
      });
    }

    // Check if employee ID already exists
    const existingEmployeeId = await db.get(
      'SELECT uid, id_number FROM emp_list WHERE id_number = ?', 
      [employeeId]
    );

    if (existingEmployeeId) {
      return res.status(400).json({
        success: false,
        error: "An employee with this ID already exists"
      });
    }

    // Generate username if not provided
    const generatedUsername = username || `${firstName.toLowerCase()}${lastName.toLowerCase()}`.replace(/\s/g, '');

    // Insert new employee
    const insertQuery = `
      INSERT INTO emp_list (
        first_name, middle_name, last_name, age, birth_date, contact_number, email,
        civil_status, address, hire_date, position, department, status, id_number, id_barcode, salary,
        tin_number, sss_number, pagibig_number, philhealth_number,
        username, access_level, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

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
      hireDate || new Date().toISOString().split('T')[0], // Default to today if not provided
      position,
      department,
      status,
      employeeId, // Maps to id_number
      idBarcode || null, // Maps to id_barcode (optional)
      salary || null,
      tinNumber || null,
      sssNumber || null,
      pagibigNumber || null,
      philhealthNumber || null,
      generatedUsername,
      accessLevel,
      new Date().toISOString()
    ]);

    if (result.changes > 0) {
      // Fetch the newly created employee
      const newEmployee = await db.get(`
        SELECT 
          uid as id,
          (first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name) as full_name,
          first_name, middle_name, last_name, age, birth_date, contact_number, email,
          civil_status, address, hire_date, position, department, status, id_number, id_barcode, salary,
          tin_number, sss_number, pagibig_number, philhealth_number,
          username, access_level, created_at
        FROM emp_list 
        WHERE uid = ?
      `, [result.lastID]);

      console.log(`Successfully added employee: ${newEmployee.full_name} (ID: ${result.lastID}, Employee ID: ${newEmployee.id_number})`);

      res.status(201).json({
        success: true,
        message: `Employee ${newEmployee.full_name} has been added successfully`,
        data: {
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
          employeeId: newEmployee.id_number, // Return as employeeId for frontend consistency
          idBarcode: newEmployee.id_barcode,
          salary: newEmployee.salary,
          tinNumber: newEmployee.tin_number,
          sssNumber: newEmployee.sss_number,
          pagibigNumber: newEmployee.pagibig_number,
          philhealthNumber: newEmployee.philhealth_number,
          username: newEmployee.username,
          accessLevel: newEmployee.access_level,
          createdAt: newEmployee.created_at
        }
      });

    } else {
      throw new Error('Failed to insert employee record');
    }

  } catch (error) {
    console.error("Error adding employee:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to add employee",
      message: error.message 
    });
  }
});

// PUT API endpoint for updating existing employees
app.put("/api/employees/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ 
        success: false,
        error: "Database not initialized" 
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid employee ID" 
      });
    }

    // Check if employee exists
    const existingEmployee = await db.get('SELECT uid FROM emp_list WHERE uid = ?', [id]);
    if (!existingEmployee) {
      return res.status(404).json({ 
        success: false,
        error: "Employee not found" 
      });
    }

    // Build dynamic update query based on provided fields
    const allowedFields = [
      'first_name', 'middle_name', 'last_name', 'age', 'birth_date', 'contact_number', 
      'email', 'civil_status', 'address', 'hire_date', 'position', 'department', 
      'status', 'salary', 'tin_number', 'sss_number', 'pagibig_number', 'philhealth_number'
    ];

    const updateFields = [];
    const values = [];

    // Map frontend field names to database field names
    const fieldMapping = {
      firstName: 'first_name',
      middleName: 'middle_name',
      lastName: 'last_name',
      birthDate: 'birth_date',
      contactNumber: 'contact_number',
      civilStatus: 'civil_status',
      hireDate: 'hire_date',
      tinNumber: 'tin_number',
      sssNumber: 'sss_number',
      pagibigNumber: 'pagibig_number',
      philhealthNumber: 'philhealth_number'
    };

    Object.keys(updateData).forEach(key => {
      const dbField = fieldMapping[key] || key;
      if (allowedFields.includes(dbField) && updateData[key] !== undefined) {
        updateFields.push(`${dbField} = ?`);
        values.push(updateData[key]);
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid fields provided for update"
      });
    }

    // Add employee ID to values array
    values.push(id);

    const updateQuery = `UPDATE emp_list SET ${updateFields.join(', ')} WHERE uid = ?`;
    
    console.log('Updating employee:', { id, fields: updateFields }); // Debug log

    const result = await db.run(updateQuery, values);

    if (result.changes > 0) {
      // Fetch updated employee data
      const updatedEmployee = await db.get(`
        SELECT 
          uid as id,
          (first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name) as full_name,
          first_name, middle_name, last_name, position, department, email, status
        FROM emp_list 
        WHERE uid = ?
      `, [id]);

      console.log(`Successfully updated employee: ${updatedEmployee.full_name}`);

      res.json({
        success: true,
        message: `Employee ${updatedEmployee.full_name} has been updated successfully`,
        data: updatedEmployee
      });
    } else {
      res.status(400).json({
        success: false,
        error: "No changes were made to the employee record"
      });
    }

  } catch (error) {
    console.error("Error updating employee:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to update employee",
      message: error.message 
    });
  }
});

// GET endpoint to fetch departments for dropdown
app.get("/api/departments", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ 
        success: false,
        error: "Database not initialized" 
      });
    }

    const departments = await db.all(`
      SELECT 
        COALESCE(department, 'Unassigned') as name,
        COUNT(*) as employee_count,
        COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_count
      FROM emp_list 
      WHERE department IS NOT NULL AND department != ''
      GROUP BY department 
      ORDER BY employee_count DESC
    `);

    // Add predefined departments that might not have employees yet
    const predefinedDepts = [
      'Human Resources',
      'Engineering', 
      'Finance',
      'Marketing',
      'Information Technology',
      'Operations',
      'Procurement'
    ];

    const existingDeptNames = departments.map(d => d.name);
    predefinedDepts.forEach(dept => {
      if (!existingDeptNames.includes(dept)) {
        departments.push({
          name: dept,
          employee_count: 0,
          active_count: 0
        });
      }
    });

    res.json({
      success: true,
      data: departments
    });

  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch departments",
      message: error.message 
    });
  }
});

// Replace your existing validation endpoint in server.js with this improved version:

app.get("/api/employees/validate", async (req, res) => {
  console.log('=== VALIDATION ENDPOINT START ===');
  console.log('Raw query params:', req.query);
  
  try {
    if (!db) {
      console.error('Database not initialized');
      return res.status(500).json({ 
        success: false,
        error: "Database not initialized" 
      });
    }

    const { email, username, employeeId, idBarcode, excludeId } = req.query;
    
    console.log('Validation request received:', { email, username, employeeId, idBarcode, excludeId });
    
    // Validate that at least one field is provided
    if (!email && !username && !employeeId && !idBarcode) {
      console.log('No validation fields provided');
      return res.status(400).json({
        success: false,
        error: "At least one field must be provided for validation"
      });
    }
    
    const validationResults = {};

    // Check email uniqueness
    if (email && email.trim()) {
      try {
        let emailQuery = 'SELECT uid FROM emp_list WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))';
        let emailParams = [email];
        
        if (excludeId && !isNaN(parseInt(excludeId))) {
          emailQuery += ' AND uid != ?';
          emailParams.push(parseInt(excludeId));
        }
        
        const emailExists = await db.get(emailQuery, emailParams);
        validationResults.emailAvailable = !emailExists;
        console.log('Email validation result:', { email, exists: !!emailExists, available: !emailExists });
      } catch (dbError) {
        console.error("Database error checking email:", dbError);
        return res.status(500).json({
          success: false,
          error: "Database error while checking email",
          details: dbError.message
        });
      }
    }

    // Check username uniqueness
    if (username && username.trim()) {
      try {
        let usernameQuery = 'SELECT uid FROM emp_list WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))';
        let usernameParams = [username];
        
        if (excludeId && !isNaN(parseInt(excludeId))) {
          usernameQuery += ' AND uid != ?';
          usernameParams.push(parseInt(excludeId));
        }
        
        const usernameExists = await db.get(usernameQuery, usernameParams);
        validationResults.usernameAvailable = !usernameExists;
        console.log('Username validation result:', { username, exists: !!usernameExists, available: !usernameExists });
      } catch (dbError) {
        console.error("Database error checking username:", dbError);
        return res.status(500).json({
          success: false,
          error: "Database error while checking username",
          details: dbError.message
        });
      }
    }

    // Check employee ID uniqueness - FIXED VALIDATION
    if (employeeId && employeeId.trim()) {
      try {
        const trimmedEmployeeId = employeeId.trim();
        
        // Remove overly strict validation - accept any non-empty employee ID
        if (!trimmedEmployeeId) {
          validationResults.employeeIdAvailable = false;
          return res.json({
            success: true,
            data: { ...validationResults, employeeIdAvailable: false }
          });
        }

        let employeeIdQuery = 'SELECT uid, id_number FROM emp_list WHERE TRIM(id_number) = ?';
        let employeeIdParams = [trimmedEmployeeId];
        
        if (excludeId && !isNaN(parseInt(excludeId))) {
          employeeIdQuery += ' AND uid != ?';
          employeeIdParams.push(parseInt(excludeId));
        }
        
        console.log('Executing employee ID query:', { 
          query: employeeIdQuery, 
          params: employeeIdParams,
          originalEmployeeId: employeeId,
          trimmedEmployeeId: trimmedEmployeeId
        });
        
        const employeeIdExists = await db.get(employeeIdQuery, employeeIdParams);
        validationResults.employeeIdAvailable = !employeeIdExists;
        console.log('Employee ID validation result:', { 
          employeeId: trimmedEmployeeId, 
          exists: !!employeeIdExists, 
          available: !employeeIdExists,
          foundRecord: employeeIdExists 
        });
        
      } catch (dbError) {
        console.error("Database error checking employee ID:", dbError);
        return res.status(500).json({
          success: false,
          error: "Database error while checking employee ID",
          details: dbError.message
        });
      }
    }

    // Check ID barcode uniqueness
    if (idBarcode && idBarcode.trim()) {
      try {
        let barcodeQuery = 'SELECT uid FROM emp_list WHERE TRIM(id_barcode) = TRIM(?)';
        let barcodeParams = [idBarcode];
        
        if (excludeId && !isNaN(parseInt(excludeId))) {
          barcodeQuery += ' AND uid != ?';
          barcodeParams.push(parseInt(excludeId));
        }
        
        const barcodeExists = await db.get(barcodeQuery, barcodeParams);
        validationResults.idBarcodeAvailable = !barcodeExists;
        console.log('ID Barcode validation result:', { idBarcode, exists: !!barcodeExists, available: !barcodeExists });
      } catch (dbError) {
        console.error("Database error checking ID barcode:", dbError);
        return res.status(500).json({
          success: false,
          error: "Database error while checking ID barcode",
          details: dbError.message
        });
      }
    }

    console.log('Final validation results:', validationResults);

    // Always return success with the validation results
    res.json({
      success: true,
      data: validationResults
    });

  } catch (error) {
    console.error("Unexpected error in validation endpoint:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to validate employee data",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get all tables
app.get("/api/tables", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const tables = await db.all(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `)
    res.json(tables)
  } catch (error) {
    console.error("Error getting tables:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get table schema
app.get("/api/tables/:tableName/schema", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName } = req.params

    // Validate table name to prevent SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    const schema = await db.all(`PRAGMA table_info(${tableName})`)
    res.json(schema)
  } catch (error) {
    console.error("Error getting table schema:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get all records from a table stats
app.get("/api/tables/:tableName/data", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { tableName } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" });
    }

    // Validate and sanitize limit and offset
    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 100), 1000);
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0);

    // Fetch paginated data
    const data = await db.all(`
      SELECT * FROM ${tableName}
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `);

    // Total count
    const total = await db.get(`SELECT COUNT(*) as count FROM ${tableName}`);

    // New hires in last 30 days (requires a 'created_at' column)
    const newHires = await db.get(`
      SELECT COUNT(*) as count FROM ${tableName}
      WHERE created_at >= datetime('now', '-30 days')
    `);

    // Open positions (employees with no department assigned)
    const openPositions = await db.get(`
      SELECT COUNT(*) as count FROM ${tableName}
      WHERE department IS NULL OR department = ''
    `);

    res.json({
      data,
      total: total.count,
      limit: parsedLimit,
      offset: parsedOffset,
      stats: {
        total: total.count,
        newHires: newHires.count,
        openPositions: openPositions.count,
      },
    });
  } catch (error) {
    console.error("Error getting table data:", error);
    res.status(500).json({ error: error.message });
  }
});

// Insert new record
app.post("/api/tables/:tableName/data", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName } = req.params
    const data = req.body

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Invalid data provided" })
    }

    const columns = Object.keys(data).join(", ")
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ")
    const values = Object.values(data)

    const result = await db.run(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`, values)

    res.json({
      success: true,
      id: result.lastID,
      message: "Record inserted successfully",
    })
  } catch (error) {
    console.error("Error inserting record:", error)
    res.status(500).json({ error: error.message })
  }
})

// Update record
app.put("/api/tables/:tableName/data/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName, id } = req.params
    const data = req.body

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    // Validate ID
    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Invalid data provided" })
    }

    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ")
    const values = [...Object.values(data), Number.parseInt(id)]

    const result = await db.run(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`, values)

    if (result.changes === 0) {
      return res.status(404).json({ error: "Record not found" })
    }

    res.json({
      success: true,
      changes: result.changes,
      message: "Record updated successfully",
    })
  } catch (error) {
    console.error("Error updating record:", error)
    res.status(500).json({ error: error.message })
  }
})

// Delete record
app.delete("/api/tables/:tableName/data/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { tableName, id } = req.params

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    // Validate ID
    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    const result = await db.run(`DELETE FROM ${tableName} WHERE id = ?`, [Number.parseInt(id)])

    if (result.changes === 0) {
      return res.status(404).json({ error: "Record not found" })
    }

    res.json({
      success: true,
      changes: result.changes,
      message: "Record deleted successfully",
    })
  } catch (error) {
    console.error("Error deleting record:", error)
    res.status(500).json({ error: error.message })
  }
})

// Execute custom SQL query (GET for SELECT, POST for others)
app.post("/api/query", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" })
    }

    const { sql, params = [] } = req.body

    if (!sql) {
      return res.status(400).json({ error: "SQL query is required" })
    }

    // Basic validation to prevent obviously dangerous queries
    const trimmedSql = sql.trim().toLowerCase()
    const dangerousKeywords = ["drop", "delete", "truncate", "alter"]
    const isSelect = trimmedSql.startsWith("select")

    if (!isSelect && dangerousKeywords.some((keyword) => trimmedSql.includes(keyword))) {
      return res.status(400).json({ error: "Potentially dangerous query detected" })
    }

    if (isSelect) {
      const result = await db.all(sql, params)
      res.json({ data: result, type: "select" })
    } else {
      const result = await db.run(sql, params)
      res.json({
        success: true,
        changes: result.changes || 0,
        lastID: result.lastID || null,
        type: "modify",
      })
    }
  } catch (error) {
    console.error("Error executing query:", error)
    res.status(500).json({ error: error.message })
  }
})

// Static file serving fallback (if Vite is not running)
const staticPath = path.join(__dirname, "..", "web-app", "dist")
if (fs.existsSync(staticPath)) {
  console.log(`📁 Static files available at: ${staticPath}`)
  
  // Serve static files with proper headers for SPA
  app.use(express.static(staticPath, {
    // Cache static assets for better performance
    maxAge: USE_PRODUCTION_BUILD ? '1y' : 0,
    // Handle client-side routing
    fallthrough: true
  }))
  
  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/')) {
      return next()
    }
    
    // Skip if Vite is handling the request
    if (viteProcess && !USE_PRODUCTION_BUILD) {
      return next()
    }
    
    // Serve index.html for SPA routes
    const indexPath = path.join(staticPath, 'index.html')
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      next()
    }
  })
}

// Vite proxy (only if Vite process is running)
app.use("/", (req, res, next) => {
  if (viteProcess && !USE_PRODUCTION_BUILD) {
    // Use proxy if Vite is running and not using production build
    createProxyMiddleware({
      target: `http://localhost:${VITE_PORT}`,
      changeOrigin: true,
      ws: true,
      logLevel: "silent",
      onError: (err, req, res) => {
        console.error("Proxy error:", err.message)
        res.status(500).send("Vite development server not available")
      },
    })(req, res, next)
  } else {
    // This will be handled by the static file middleware above
    next()
  }
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error)
  res.status(500).json({
    error: "Internal server error",
    message: error.message,
    timestamp: new Date().toISOString(),
  })
})

// Graceful shutdown handling
process.on("SIGTERM", async () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully...")
  if (db) {
    await db.close()
    console.log("🔴 Database connection closed")
  }
  if (viteProcess) {
    viteProcess.kill()
    console.log("🔴 Vite process terminated")
  }
  process.exit(0)
})

process.on("SIGINT", async () => {
  console.log("🛑 Received SIGINT, shutting down gracefully...")
  if (db) {
    await db.close()
    console.log("🔴 Database connection closed")
  }
  if (viteProcess) {
    viteProcess.kill()
    console.log("🔴 Vite process terminated")
  }
  process.exit(0)
})

function findAvailablePort(startPort = 3001) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.listen(startPort, (err) => {
      if (err) {
        // Port is in use, try the next one
        server.close();
        resolve(findAvailablePort(startPort + 1));
      } else {
        const port = server.address().port;
        server.close();
        resolve(port);
      }
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try the next one
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

// Modify the startServer function:
async function startServer() {
  try {
    console.log("🚀 Initializing SQLite Database Server...")
    console.log(`📂 Working directory: ${process.cwd()}`)
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`)
    console.log(`📁 Database directory: ${process.env.DATABASE_DIR || process.cwd()}`)
    console.log(`🖥️ Platform: ${process.platform}`)

    await initDatabase()

    // Find an available port dynamically
    const availablePort = await findAvailablePort(PORT);
    
    if (availablePort !== PORT) {
      console.log(`⚠️ Port ${PORT} is in use, using port ${availablePort} instead`);
    }

    await startViteServer()

    const server = app.listen(availablePort, "0.0.0.0", () => {
      console.log(`✅ Database server running on http://0.0.0.0:${availablePort}`)
      console.log(`📊 Database API available at http://localhost:${availablePort}/api`)
      
      if (viteProcess) {
        console.log(`⚛️ React app (Vite dev) available at http://localhost:${availablePort}`)
      } else {
        const staticPath = path.join(__dirname, "..", "web-app", "dist")
        if (fs.existsSync(staticPath)) {
          console.log(`⚛️ React app (static) available at http://localhost:${availablePort}`)
        } else {
          console.log(`⚠️ Frontend not available - API only mode`)
        }
      }
      
      console.log(`🌐 Server ready for connections on port ${availablePort}`)
    })

    // Handle server errors
    server.on("error", (error) => {
      console.error("❌ Server error:", error)
      process.exit(1)
    })

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("🛑 Received SIGTERM, closing server...")
      server.close(() => {
        console.log("🔴 Server closed")
      })
    })
  } catch (error) {
    console.error("❌ Failed to start server:", error)
    console.error("Stack trace:", error.stack)
    process.exit(1)
  }
}

// Start the server
startServer()