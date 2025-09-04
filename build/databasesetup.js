const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseSetup {
  constructor(databasePath) {
    this.databasePath = databasePath;
    this.db = null;
  }

  /**
   * Initialize the database connection
   */
  initializeConnection() {
    try {
      // Ensure the directory exists
      const dbDir = path.dirname(this.databasePath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new Database(this.databasePath);
      
      // Enable foreign keys and set performance optimizations
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      
      console.log(`✅ Database connection established: ${this.databasePath}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize database connection:', error);
      return false;
    }
  }

  /**
   * Check if database exists and has tables
   */
  checkDatabaseExists() {
    try {
      if (!fs.existsSync(this.databasePath)) {
        console.log('📝 Database file does not exist, will create new database');
        return false;
      }

      if (!this.db) {
        this.initializeConnection();
      }

      // Check if tables exist
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const requiredTables = ['admin_logs', 'emp_list', 'employee_logs', 'itemsdb', 'attendance'];
      const existingTables = tables.map(t => t.name);
      
      const missingTables = requiredTables.filter(table => !existingTables.includes(table));
      
      if (missingTables.length > 0) {
        console.log(`📝 Missing tables: ${missingTables.join(', ')}`);
        return false;
      }

      console.log('✅ Database exists with all required tables');
      return true;
    } catch (error) {
      console.error('❌ Error checking database existence:', error);
      return false;
    }
  }

  /**
   * Create all required tables
   */
  createTables() {
    try {
      if (!this.db) {
        if (!this.initializeConnection()) {
          throw new Error('Failed to initialize database connection');
        }
      }

      console.log('🏗️ Creating database tables...');

      // Create admin_logs table
      const createAdminLogs = `
        CREATE TABLE IF NOT EXISTS admin_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          log_date DATE DEFAULT (date('now')),
          log_time TIME DEFAULT (time('now')),
          username VARCHAR(50) DEFAULT NULL,
          details VARCHAR(255) DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // Create emp_list table
      const createEmpList = `
        CREATE TABLE IF NOT EXISTS emp_list (
          uid INTEGER PRIMARY KEY AUTOINCREMENT,
          last_name TEXT,
          first_name TEXT,
          middle_name TEXT,
          username TEXT UNIQUE,
          access_level TEXT,
          password_salt TEXT,
          password_hash TEXT,
          tfa_salt TEXT,
          tfa_hash TEXT,
          department TEXT,
          action TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          philhealth_number TEXT,
          age INTEGER,
          birth_date TEXT,
          contact_number TEXT,
          email TEXT,
          civil_status TEXT,
          address TEXT,
          hire_date TEXT,
          position TEXT,
          status TEXT DEFAULT 'Active',
          salary TEXT,
          id_number TEXT,
          id_barcode TEXT,
          tin_number TEXT,
          sss_number TEXT,
          pagibig_number TEXT,
          updated_at TEXT,
          profile_picture BLOB,
          document BLOB
        )
      `;

      // Create employee_logs table
      const createEmployeeLogs = `
        CREATE TABLE IF NOT EXISTS employee_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          log_date DATE DEFAULT (date('now')),
          log_time TIME DEFAULT (time('now')),
          username VARCHAR(50) DEFAULT NULL,
          details VARCHAR(255) DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // Create itemsdb table
      const createItemsDb = `
        CREATE TABLE IF NOT EXISTS itemsdb (
          item_no INTEGER PRIMARY KEY AUTOINCREMENT,
          item_name TEXT,
          brand TEXT,
          item_type TEXT,
          location TEXT,
          unit_of_measure TEXT,
          in_qty INTEGER DEFAULT 0,
          out_qty INTEGER DEFAULT 0,
          balance INTEGER DEFAULT 0,
          min_stock INTEGER DEFAULT 0,
          deficit INTEGER DEFAULT 0,
          price_per_unit REAL DEFAULT 0,
          cost REAL DEFAULT 0,
          item_status TEXT DEFAULT 'Available',
          last_po TEXT,
          supplier TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // Create attendance table
      const createAttendance = `
        CREATE TABLE IF NOT EXISTS attendance (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_uid INTEGER NOT NULL,
          id_number TEXT NOT NULL,
          clock_type TEXT NOT NULL CHECK (clock_type IN ('morning_in', 'morning_out', 'afternoon_in', 'afternoon_out', 'overtime_in', 'overtime_out')),
          clock_time DATETIME NOT NULL,
          regular_hours REAL DEFAULT 0,
          overtime_hours REAL DEFAULT 0,
          date DATE NOT NULL,
          is_synced INTEGER DEFAULT 0 CHECK (is_synced IN (0, 1)),
          is_late INTEGER DEFAULT 0 CHECK (is_late IN (0, 1)),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          notes TEXT,
          location TEXT,
          ip_address TEXT,
          device_info TEXT,
          FOREIGN KEY (employee_uid) REFERENCES emp_list(uid) ON DELETE CASCADE
        )
      `;

      // Execute table creation queries
      this.db.exec(createAdminLogs);
      console.log('✅ Created admin_logs table');

      this.db.exec(createEmpList);
      console.log('✅ Created emp_list table');

      this.db.exec(createEmployeeLogs);
      console.log('✅ Created employee_logs table');

      this.db.exec(createItemsDb);
      console.log('✅ Created itemsdb table');

      this.db.exec(createAttendance);
      console.log('✅ Created attendance table');

      // Create indexes for better performance
      this.createIndexes();

      console.log('🎉 All tables created successfully!');
      return true;
    } catch (error) {
      console.error('❌ Error creating tables:', error);
      return false;
    }
  }

  /**
   * Create database indexes for better performance
   */
  createIndexes() {
    try {
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_admin_logs_date ON admin_logs(log_date)',
        'CREATE INDEX IF NOT EXISTS idx_admin_logs_username ON admin_logs(username)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_username ON emp_list(username)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_department ON emp_list(department)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_status ON emp_list(status)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_id_number ON emp_list(id_number)',
        'CREATE INDEX IF NOT EXISTS idx_employee_logs_date ON employee_logs(log_date)',
        'CREATE INDEX IF NOT EXISTS idx_employee_logs_username ON employee_logs(username)',
        'CREATE INDEX IF NOT EXISTS idx_itemsdb_name ON itemsdb(item_name)',
        'CREATE INDEX IF NOT EXISTS idx_itemsdb_type ON itemsdb(item_type)',
        'CREATE INDEX IF NOT EXISTS idx_itemsdb_status ON itemsdb(item_status)',
        'CREATE INDEX IF NOT EXISTS idx_itemsdb_supplier ON itemsdb(supplier)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_employee_uid ON attendance(employee_uid)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_id_number ON attendance(id_number)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_clock_type ON attendance(clock_type)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_date_employee ON attendance(date, employee_uid)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_is_late ON attendance(is_late)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_is_synced ON attendance(is_synced)'
      ];

      indexes.forEach(indexQuery => {
        this.db.exec(indexQuery);
      });

      console.log('✅ Database indexes created');
    } catch (error) {
      console.error('⚠️ Error creating indexes:', error);
    }
  }

  /**
   * Insert sample data for testing (optional)
   */
  insertSampleData() {
    try {
      console.log('📝 Inserting sample data...');

      // Sample admin user
      const insertAdmin = this.db.prepare(`
        INSERT OR IGNORE INTO emp_list (
          last_name, first_name, username, access_level, 
          password_salt, password_hash, department, status, id_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertAdmin.run(
        'Administrator',
        'System',
        'admin',
        'admin',
        'sample_salt',
        'sample_hash',
        'IT',
        'Active',
        '00001'
      );

      // Sample employee
      const insertEmployee = this.db.prepare(`
        INSERT OR IGNORE INTO emp_list (
          last_name, first_name, middle_name, username, access_level,
          password_salt, password_hash, department, status, id_number, 
          id_barcode, email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertEmployee.run(
        'Ablao',
        'Emmanuel',
        'Sapico',
        'eablao',
        'employee',
        'sample_salt',
        'sample_hash',
        'Human Resources',
        'Active',
        '25063',
        '12307584',
        'emmanuelablao16@gmail.com'
      );

      // Sample log entries
      const insertLog = this.db.prepare(`
        INSERT INTO admin_logs (username, details) VALUES (?, ?)
      `);

      insertLog.run('admin', 'Database initialized successfully');

      // Sample attendance records
      const insertAttendance = this.db.prepare(`
        INSERT INTO attendance (
          employee_uid, id_number, clock_type, clock_time, 
          regular_hours, overtime_hours, date, is_synced, is_late
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const currentDate = new Date().toISOString().split('T')[0];
      
      insertAttendance.run(2, '25063', 'morning_in', '2025-09-04T08:00:00.000', 0, 0, currentDate, 0, 0);
      insertAttendance.run(2, '25063', 'morning_out', '2025-09-04T12:00:00.000', 4, 0, currentDate, 0, 0);
      insertAttendance.run(2, '25063', 'afternoon_in', '2025-09-04T13:00:00.000', 0, 0, currentDate, 0, 0);
      insertAttendance.run(2, '25063', 'afternoon_out', '2025-09-04T17:00:00.000', 4, 0, currentDate, 0, 0);

      console.log('✅ Sample data inserted');
      return true;
    } catch (error) {
      console.error('❌ Error inserting sample data:', error);
      return false;
    }
  }

  /**
   * Setup the complete database
   */
  async setupDatabase(insertSampleData = false) {
    try {
      console.log('🚀 Starting database setup...');

      // Check if database already exists
      if (this.checkDatabaseExists()) {
        console.log('ℹ️ Database already exists and is properly configured');
        return { success: true, message: 'Database already exists' };
      }

      // Initialize connection
      if (!this.initializeConnection()) {
        throw new Error('Failed to initialize database connection');
      }

      // Create tables
      if (!this.createTables()) {
        throw new Error('Failed to create database tables');
      }

      // Insert sample data if requested
      if (insertSampleData) {
        this.insertSampleData();
      }

      console.log('🎉 Database setup completed successfully!');
      return { success: true, message: 'Database setup completed successfully' };

    } catch (error) {
      console.error('❌ Database setup failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get database statistics
   */
  getDatabaseStats() {
    try {
      if (!this.db) {
        return null;
      }

      const stats = {
        tables: {},
        size: 0
      };

      // Get table row counts
      const tables = ['admin_logs', 'emp_list', 'employee_logs', 'itemsdb', 'attendance'];
      
      tables.forEach(table => {
        try {
          const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
          stats.tables[table] = result.count;
        } catch (error) {
          stats.tables[table] = 0;
        }
      });

      // Get database file size
      if (fs.existsSync(this.databasePath)) {
        const fileStats = fs.statSync(this.databasePath);
        stats.size = fileStats.size;
      }

      return stats;
    } catch (error) {
      console.error('❌ Error getting database stats:', error);
      return null;
    }
  }

  /**
   * Helper method to add attendance record
   */
  addAttendanceRecord(employeeUid, idNumber, clockType, clockTime, regularHours = 0, overtimeHours = 0, isLate = 0, notes = null) {
    try {
      if (!this.db) {
        if (!this.initializeConnection()) {
          throw new Error('Database connection failed');
        }
      }

      const insertAttendance = this.db.prepare(`
        INSERT INTO attendance (
          employee_uid, id_number, clock_type, clock_time, 
          regular_hours, overtime_hours, date, is_late, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const date = new Date(clockTime).toISOString().split('T')[0];
      
      const result = insertAttendance.run(
        employeeUid, idNumber, clockType, clockTime,
        regularHours, overtimeHours, date, isLate, notes
      );

      return { success: true, attendanceId: result.lastInsertRowid };
    } catch (error) {
      console.error('❌ Error adding attendance record:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Helper method to get attendance records for an employee
   */
  getEmployeeAttendance(employeeUid, startDate = null, endDate = null) {
    try {
      if (!this.db) {
        if (!this.initializeConnection()) {
          throw new Error('Database connection failed');
        }
      }

      let query = `
        SELECT a.*, e.first_name, e.last_name, e.department
        FROM attendance a
        JOIN emp_list e ON a.employee_uid = e.uid
        WHERE a.employee_uid = ?
      `;
      
      const params = [employeeUid];

      if (startDate) {
        query += ` AND a.date >= ?`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND a.date <= ?`;
        params.push(endDate);
      }

      query += ` ORDER BY a.clock_time DESC`;

      const stmt = this.db.prepare(query);
      const records = stmt.all(...params);

      return { success: true, records };
    } catch (error) {
      console.error('❌ Error getting attendance records:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('✅ Database connection closed');
    }
  }

  /**
   * Test database connection and operations
   */
  testDatabase() {
    try {
      if (!this.db) {
        if (!this.initializeConnection()) {
          return { success: false, error: 'Failed to connect to database' };
        }
      }

      // Test basic operations
      const testQuery = this.db.prepare('SELECT 1 as test').get();
      const stats = this.getDatabaseStats();

      return {
        success: true,
        message: 'Database test passed',
        stats: stats,
        testResult: testQuery
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = DatabaseSetup;