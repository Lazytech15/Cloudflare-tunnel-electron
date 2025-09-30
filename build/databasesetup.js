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
      const requiredTables = ['admin_logs', 'emp_list', 'employee_logs', 'itemsdb', 'attendance', 'daily_attendance_summary', 'purchase_orders', 'purchase_order_items'];
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

      // Create attendance table with updated constraints
      const createAttendance = `
        CREATE TABLE IF NOT EXISTS attendance (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_uid INTEGER NOT NULL,
          id_number TEXT NOT NULL,
          id_barcode TEXT,
          clock_type TEXT NOT NULL CHECK (clock_type IN (
            'morning_in', 'morning_out', 'afternoon_in', 'afternoon_out', 
            'evening_in', 'evening_out', 'overtime_in', 'overtime_out'
          )),
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

      // Create daily_attendance_summary table (fixed foreign key reference)
      const createDailySummary = `
        CREATE TABLE IF NOT EXISTS daily_attendance_summary (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_uid INTEGER,
          id_number TEXT,
          id_barcode TEXT,
          employee_name TEXT NOT NULL,
          first_name TEXT,
          last_name TEXT,
          department TEXT,
          
          -- Time tracking
          date TEXT NOT NULL,
          first_clock_in DATETIME,
          last_clock_out DATETIME,
          
          -- Session details
          morning_in DATETIME,
          morning_out DATETIME,
          afternoon_in DATETIME,
          afternoon_out DATETIME,
          evening_in DATETIME,
          evening_out DATETIME,
          overtime_in DATETIME,
          overtime_out DATETIME,
          
          -- Hours calculation
          regular_hours REAL DEFAULT 0,
          overtime_hours REAL DEFAULT 0,
          total_hours REAL DEFAULT 0,
          
          -- Session hours breakdown
          morning_hours REAL DEFAULT 0,
          afternoon_hours REAL DEFAULT 0,
          evening_hours REAL DEFAULT 0,
          overtime_session_hours REAL DEFAULT 0,
          
          -- Status flags
          is_incomplete INTEGER DEFAULT 0, -- Has pending clock-out
          has_late_entry INTEGER DEFAULT 0,
          has_overtime INTEGER DEFAULT 0,
          has_evening_session INTEGER DEFAULT 0,
          
          -- Metadata
          total_sessions INTEGER DEFAULT 0,
          completed_sessions INTEGER DEFAULT 0,
          pending_sessions INTEGER DEFAULT 0,
          
          -- Time calculations
          total_minutes_worked INTEGER DEFAULT 0,
          break_time_minutes INTEGER DEFAULT 0, -- Future: track lunch breaks
          
          -- Sync and audit
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          
          -- Constraints (fixed to reference emp_list instead of employees)
          FOREIGN KEY (employee_uid) REFERENCES emp_list (uid),
          UNIQUE(employee_uid, date)
        )
      `;

      // Create purchase_orders table
      const createPurchaseOrders = `
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id TEXT PRIMARY KEY,
          supplier TEXT NOT NULL,
          status TEXT DEFAULT 'requested' CHECK (status IN ('requested', 'ordered', 'in_transit', 'ready_for_pickup', 'received', 'cancelled')),
          order_date DATE NOT NULL,
          expected_delivery_date DATE,
          actual_delivery_date DATE,
          total_items INTEGER DEFAULT 0,
          total_quantity INTEGER DEFAULT 0,
          total_value REAL DEFAULT 0,
          notes TEXT,
          priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
          created_by TEXT,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // Create purchase_order_items table
      const createPurchaseOrderItems = `
        CREATE TABLE IF NOT EXISTS purchase_order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_order_id TEXT NOT NULL,
          item_no TEXT NOT NULL,
          item_name TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price REAL NOT NULL,
          status TEXT DEFAULT 'ordered' CHECK (status IN ('ordered', 'in_transit', 'received', 'cancelled')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
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

      this.db.exec(createDailySummary);
      console.log('✅ Created daily_attendance_summary table');

      this.db.exec(createPurchaseOrders);
      console.log('✅ Created purchase_orders table');

      this.db.exec(createPurchaseOrderItems);
      console.log('✅ Created purchase_order_items table');

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
        // Original indexes
        'CREATE INDEX IF NOT EXISTS idx_admin_logs_date ON admin_logs(log_date)',
        'CREATE INDEX IF NOT EXISTS idx_admin_logs_username ON admin_logs(username)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_username ON emp_list(username)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_department ON emp_list(department)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_status ON emp_list(status)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_id_number ON emp_list(id_number)',
        'CREATE INDEX IF NOT EXISTS idx_emp_list_id_barcode ON emp_list(id_barcode)',
        'CREATE INDEX IF NOT EXISTS idx_employee_logs_date ON employee_logs(log_date)',
        'CREATE INDEX IF NOT EXISTS idx_employee_logs_username ON employee_logs(username)',
        'CREATE INDEX IF NOT EXISTS idx_itemsdb_name ON itemsdb(item_name)',
        'CREATE INDEX IF NOT EXISTS idx_itemsdb_type ON itemsdb(item_type)',
        'CREATE INDEX IF NOT EXISTS idx_itemsdb_status ON itemsdb(item_status)',
        'CREATE INDEX IF NOT EXISTS idx_itemsdb_supplier ON itemsdb(supplier)',
        
        // Attendance table indexes
        'CREATE INDEX IF NOT EXISTS idx_attendance_employee_uid ON attendance(employee_uid)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_id_number ON attendance(id_number)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_id_barcode ON attendance(id_barcode)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_clock_type ON attendance(clock_type)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_date_employee ON attendance(date, employee_uid)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_is_late ON attendance(is_late)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_is_synced ON attendance(is_synced)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_clock_time ON attendance(clock_time)',
        
        // Daily summary table indexes
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_employee_uid ON daily_attendance_summary(employee_uid)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON daily_attendance_summary(date)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_employee_date ON daily_attendance_summary(employee_uid, date)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_id_number ON daily_attendance_summary(id_number)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_id_barcode ON daily_attendance_summary(id_barcode)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_department ON daily_attendance_summary(department)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_employee_name ON daily_attendance_summary(employee_name)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_has_overtime ON daily_attendance_summary(has_overtime)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_is_incomplete ON daily_attendance_summary(is_incomplete)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_has_late_entry ON daily_attendance_summary(has_late_entry)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_total_hours ON daily_attendance_summary(total_hours)',
        'CREATE INDEX IF NOT EXISTS idx_daily_summary_last_updated ON daily_attendance_summary(last_updated)'
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

      // Sample daily summary record
      const insertDailySummary = this.db.prepare(`
        INSERT INTO daily_attendance_summary (
          employee_uid, id_number, id_barcode, employee_name, first_name, last_name,
          department, date, morning_in, morning_out, afternoon_in, afternoon_out,
          regular_hours, overtime_hours, total_hours, morning_hours, afternoon_hours,
          total_sessions, completed_sessions, total_minutes_worked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertDailySummary.run(
        2, '25063', '12307584', 'Emmanuel Ablao', 'Emmanuel', 'Ablao',
        'Human Resources', currentDate, '2025-09-04T08:00:00.000', '2025-09-04T12:00:00.000',
        '2025-09-04T13:00:00.000', '2025-09-04T17:00:00.000', 8, 0, 8, 4, 4, 2, 2, 480
      );

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
      const tables = ['admin_logs', 'emp_list', 'employee_logs', 'itemsdb', 'attendance', 'daily_attendance_summary'];
      
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
   * Helper method to get daily attendance summary for an employee
   */
  getEmployeeDailySummary(employeeUid, startDate = null, endDate = null) {
    try {
      if (!this.db) {
        if (!this.initializeConnection()) {
          throw new Error('Database connection failed');
        }
      }

      let query = `
        SELECT * FROM daily_attendance_summary
        WHERE employee_uid = ?
      `;
      
      const params = [employeeUid];

      if (startDate) {
        query += ` AND date >= ?`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND date <= ?`;
        params.push(endDate);
      }

      query += ` ORDER BY date DESC`;

      const stmt = this.db.prepare(query);
      const records = stmt.all(...params);

      return { success: true, records };
    } catch (error) {
      console.error('❌ Error getting daily summary records:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Helper method to update daily attendance summary
   */
  updateDailySummary(summaryData) {
    try {
      if (!this.db) {
        if (!this.initializeConnection()) {
          throw new Error('Database connection failed');
        }
      }

      const upsertQuery = this.db.prepare(`
        INSERT INTO daily_attendance_summary (
          employee_uid, id_number, id_barcode, employee_name, first_name, last_name, 
          department, date, first_clock_in, last_clock_out, morning_in, morning_out,
          afternoon_in, afternoon_out, evening_in, evening_out, overtime_in, overtime_out,
          regular_hours, overtime_hours, total_hours, morning_hours, afternoon_hours,
          evening_hours, overtime_session_hours, is_incomplete, has_late_entry,
          has_overtime, has_evening_session, total_sessions, completed_sessions,
          pending_sessions, total_minutes_worked, break_time_minutes, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (employee_uid, date) DO UPDATE SET
          id_number = excluded.id_number,
          id_barcode = excluded.id_barcode,
          employee_name = excluded.employee_name,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          department = excluded.department,
          first_clock_in = excluded.first_clock_in,
          last_clock_out = excluded.last_clock_out,
          morning_in = excluded.morning_in,
          morning_out = excluded.morning_out,
          afternoon_in = excluded.afternoon_in,
          afternoon_out = excluded.afternoon_out,
          evening_in = excluded.evening_in,
          evening_out = excluded.evening_out,
          overtime_in = excluded.overtime_in,
          overtime_out = excluded.overtime_out,
          regular_hours = excluded.regular_hours,
          overtime_hours = excluded.overtime_hours,
          total_hours = excluded.total_hours,
          morning_hours = excluded.morning_hours,
          afternoon_hours = excluded.afternoon_hours,
          evening_hours = excluded.evening_hours,
          overtime_session_hours = excluded.overtime_session_hours,
          is_incomplete = excluded.is_incomplete,
          has_late_entry = excluded.has_late_entry,
          has_overtime = excluded.has_overtime,
          has_evening_session = excluded.has_evening_session,
          total_sessions = excluded.total_sessions,
          completed_sessions = excluded.completed_sessions,
          pending_sessions = excluded.pending_sessions,
          total_minutes_worked = excluded.total_minutes_worked,
          break_time_minutes = excluded.break_time_minutes,
          last_updated = excluded.last_updated
      `);

      const result = upsertQuery.run(
        summaryData.employee_uid, summaryData.id_number, summaryData.id_barcode,
        summaryData.employee_name, summaryData.first_name, summaryData.last_name,
        summaryData.department, summaryData.date, summaryData.first_clock_in,
        summaryData.last_clock_out, summaryData.morning_in, summaryData.morning_out,
        summaryData.afternoon_in, summaryData.afternoon_out, summaryData.evening_in,
        summaryData.evening_out, summaryData.overtime_in, summaryData.overtime_out,
        summaryData.regular_hours || 0, summaryData.overtime_hours || 0,
        summaryData.total_hours || 0, summaryData.morning_hours || 0,
        summaryData.afternoon_hours || 0, summaryData.evening_hours || 0,
        summaryData.overtime_session_hours || 0, summaryData.is_incomplete || 0,
        summaryData.has_late_entry || 0, summaryData.has_overtime || 0,
        summaryData.has_evening_session || 0, summaryData.total_sessions || 0,
        summaryData.completed_sessions || 0, summaryData.pending_sessions || 0,
        summaryData.total_minutes_worked || 0, summaryData.break_time_minutes || 0,
        summaryData.last_updated || new Date().toISOString()
      );

      return { success: true, changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    } catch (error) {
      console.error('❌ Error updating daily summary:', error);
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