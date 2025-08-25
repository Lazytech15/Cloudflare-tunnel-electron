// Socket.IO configuration and event handlers
const { Server } = require("socket.io")

let io = null

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  })

  // Connection handling
  io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`)

    // Join rooms for different data types
    socket.on("join-employees", () => {
      socket.join("employees")
      console.log(`👥 Client ${socket.id} joined employees room`)
    })

    socket.on("join-departments", () => {
      socket.join("departments")
      console.log(`🏢 Client ${socket.id} joined departments room`)
    })

    socket.on("join-auth", () => {
      socket.join("auth")
      console.log(`🔐 Client ${socket.id} joined auth room`)
    })

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      console.log(`🔌 Client disconnected: ${socket.id}, reason: ${reason}`)
    })

    // Ping/pong for connection health
    socket.on("ping", () => {
      socket.emit("pong")
    })
  })

  console.log("🔌 Socket.IO server initialized")
  return io
}

function getSocket() {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initSocket() first.")
  }
  return io
}

// Event emitters for different modules
const socketEvents = {
  // Employee events
  employeeCreated: (employee) => {
    if (io) {
      io.to("employees").emit("employee:created", employee)
      console.log(`📡 Emitted employee:created for ID ${employee.id}`)
    }
  },

  employeeUpdated: (employee) => {
    if (io) {
      io.to("employees").emit("employee:updated", employee)
      console.log(`📡 Emitted employee:updated for ID ${employee.id}`)
    }
  },

  employeeDeleted: (employeeId) => {
    if (io) {
      io.to("employees").emit("employee:deleted", { id: employeeId })
      console.log(`📡 Emitted employee:deleted for ID ${employeeId}`)
    }
  },

  // Department events
  departmentCreated: (department) => {
    if (io) {
      io.to("departments").emit("department:created", department)
      console.log(`📡 Emitted department:created for ID ${department.id}`)
    }
  },

  departmentUpdated: (department) => {
    if (io) {
      io.to("departments").emit("department:updated", department)
      console.log(`📡 Emitted department:updated for ID ${department.id}`)
    }
  },

  departmentDeleted: (departmentId) => {
    if (io) {
      io.to("departments").emit("department:deleted", { id: departmentId })
      console.log(`📡 Emitted department:deleted for ID ${departmentId}`)
    }
  },

  // Auth events
  userLoggedIn: (user) => {
    if (io) {
      io.to("auth").emit("user:logged-in", {
        id: user.id,
        username: user.username,
        role: user.role,
        timestamp: new Date().toISOString(),
      })
      console.log(`📡 Emitted user:logged-in for ${user.username}`)
    }
  },

  // Generic data change event
  dataChanged: (table, action, data) => {
    if (io) {
      io.emit("data:changed", { table, action, data, timestamp: new Date().toISOString() })
      console.log(`📡 Emitted data:changed for table ${table}, action ${action}`)
    }
  },
}

module.exports = {
  initSocket,
  getSocket,
  socketEvents,
}
