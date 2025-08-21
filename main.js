const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const { spawn } = require("child_process")
const http = require("http")
const { networkInterfaces } = require("os")
const fs = require("fs")

const PORTS = {
  DATABASE_SERVER: 3001,
}

// Keep a global reference of the window object
let mainWindow
let databaseServerProcess
let tunnelProcess
let tunnelUrl = null

// Helper function to get the correct paths for production vs development
function getAppPaths() {
  const isDev = process.env.NODE_ENV === 'development' || process.defaultApp
  
  if (isDev) {
    // Development mode
    return {
      serverScript: path.join(__dirname, "server", "database-server.js"),
      databaseDir: __dirname,
      resourcesPath: __dirname
    }
  } else {
    // Production mode - use installation directory (where the app is installed)
    const installDir = path.dirname(process.execPath)
    const resourcesPath = process.resourcesPath || installDir
    
    // Check if we have a bundled database in resources
    const bundledDbPath = path.join(resourcesPath, "app", "database.db")
    const installDbPath = path.join(installDir, "database.db")
    
    console.log(`📂 Install directory: ${installDir}`)
    console.log(`📦 Resources path: ${resourcesPath}`)
    console.log(`🔍 Looking for bundled database at: ${bundledDbPath}`)
    console.log(`🎯 Target database location: ${installDbPath}`)
    
    // Copy bundled database to main install directory if it doesn't exist
    if (fs.existsSync(bundledDbPath) && !fs.existsSync(installDbPath)) {
      try {
        fs.copyFileSync(bundledDbPath, installDbPath)
        console.log(`✅ Copied database from bundle to: ${installDbPath}`)
      } catch (error) {
        console.log(`⚠️ Could not copy bundled database: ${error.message}`)
        console.log(`⚠️ Will try to use bundled location instead`)
      }
    }
    
    // Use install directory if database exists there, otherwise use bundled location
    const finalDbDir = fs.existsSync(installDbPath) ? installDir : path.join(resourcesPath, "app")
    
    return {
      serverScript: path.join(resourcesPath, "app", "server", "database-server.js"),
      databaseDir: finalDbDir,
      resourcesPath: resourcesPath
    }
  }
}

// Helper function to get local network IP
function getLocalNetworkIP() {
  const interfaces = networkInterfaces()

  for (const interfaceName of Object.keys(interfaces)) {
    const networkInterface = interfaces[interfaceName]
    for (const alias of networkInterface) {
      if (alias.family === "IPv4" && !alias.internal && alias.address !== "127.0.0.1") {
        return alias.address
      }
    }
  }

  return "localhost" // fallback
}

// Helper function to check if a server is running on a specific host and port
function checkServerRunning(host, port) {
  return new Promise((resolve) => {
    const req = http
      .get(`http://${host}:${port}`, (res) => {
        resolve(true)
      })
      .on("error", () => {
        resolve(false)
      })

    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function createWindow() {
mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
  icon: path.join(__dirname, "build", "icon.ico"),
  autoHideMenuBar: true, 
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    enableRemoteModule: false,
    webSecurity: true,
    preload: path.join(__dirname, "preload.js"),
  },
  show: false,
  title: "Easy Access Database Manager",
});


  // Show window when ready to prevent visual flash
  mainWindow.once("ready-to-show", () => {
    mainWindow.show()

    // Focus on the window
    if (process.platform === "darwin") {
      app.dock.show()
    }
    mainWindow.focus()
  })

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null
  })

  // Load the renderer HTML
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"))
}

async function startDatabaseServer() {
  return new Promise((resolve, reject) => {
    console.log("🗄️ Starting SQLite database server...")

    const paths = getAppPaths()
    console.log("📁 Server script path:", paths.serverScript)
    console.log("📁 Database directory:", paths.databaseDir)

    // Check if server script exists
    if (!fs.existsSync(paths.serverScript)) {
      const error = new Error(`Server script not found at: ${paths.serverScript}`)
      console.error("❌", error.message)
      reject(error)
      return
    }

    // Set up environment variables for the spawned process
    const isDev = process.env.NODE_ENV === 'development' || process.defaultApp
    
    // Try multiple possible node_modules locations
    const possibleNodeModulesPaths = [
      path.join(paths.resourcesPath, 'app', 'node_modules'),
      path.join(paths.resourcesPath, 'node_modules'),
      path.join(path.dirname(process.execPath), 'node_modules'),
      path.join(process.resourcesPath, 'node_modules'),
    ]

    let nodeModulesPath = null
    for (const modulePath of possibleNodeModulesPaths) {
      console.log(`📦 Checking: ${modulePath}`)
      if (fs.existsSync(modulePath)) {
        nodeModulesPath = modulePath
        console.log(`✅ Found node_modules at: ${modulePath}`)
        break
      }
    }

    if (!nodeModulesPath) {
      console.log("⚠️ Could not find node_modules directory, trying without NODE_PATH")
    }

    console.log("📦 Final node_modules path:", nodeModulesPath)

    // Prepare environment
    const env = {
      ...process.env,
      PORT: PORTS.DATABASE_SERVER.toString(),
      HOST: "0.0.0.0",
      DATABASE_DIR: paths.databaseDir,
      NODE_ENV: process.env.NODE_ENV || "production",
    }

    // Only set NODE_PATH if we found node_modules
    if (nodeModulesPath) {
      env.NODE_PATH = nodeModulesPath
    }

    // In production, we might need to set the working directory to where node_modules exists
    const workingDir = isDev ? paths.databaseDir : (nodeModulesPath ? path.dirname(nodeModulesPath) : paths.databaseDir)

    console.log("🔧 Working directory:", workingDir)
    console.log("🌍 Environment variables:", {
      PORT: env.PORT,
      DATABASE_DIR: env.DATABASE_DIR,
      NODE_PATH: env.NODE_PATH,
      NODE_ENV: env.NODE_ENV
    })

    databaseServerProcess = spawn("node", [paths.serverScript], {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: env,
    })

    let serverStarted = false

    databaseServerProcess.stdout.on("data", (data) => {
      const output = data.toString()
      console.log("[DATABASE SERVER]:", output)

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("server-log", {
          type: "database-server",
          level: "info",
          message: output,
          timestamp: new Date().toISOString(),
        })
      }

      if (output.includes("Database server running") && !serverStarted) {
        serverStarted = true
        resolve()
      }
    })

    databaseServerProcess.stderr.on("data", (data) => {
      const output = data.toString()
      console.error("[DATABASE SERVER ERROR]:", output)

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("server-log", {
          type: "database-server",
          level: "error",
          message: output,
          timestamp: new Date().toISOString(),
        })
      }
    })

    databaseServerProcess.on("error", (error) => {
      console.error("❌ Database server process error:", error)
      reject(error)
    })

    databaseServerProcess.on("exit", (code, signal) => {
      console.log(`Database server process exited with code ${code} and signal ${signal}`)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("server-log", {
          type: "database-server",
          level: "info",
          message: `Server process exited with code ${code}`,
          timestamp: new Date().toISOString(),
        })
      }
    })

    // Timeout fallback
    setTimeout(() => {
      if (!serverStarted) {
        console.log("⏰ Server start timeout, continuing anyway...")
        resolve()
      }
    }, 15000) // Increased timeout
  })
}

async function startCloudflaredTunnel() {
  return new Promise((resolve) => {
    const networkIP = getLocalNetworkIP()
    const tunnelTarget = `http://${networkIP}:${PORTS.DATABASE_SERVER}`

    console.log("🌐 Starting Cloudflare tunnel...")
    console.log(`🚇 Tunnel target: ${tunnelTarget}`)

    tunnelProcess = spawn("cloudflared", ["tunnel", "--url", tunnelTarget], {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let urlDetected = false

    tunnelProcess.stdout.on("data", (data) => {
      const output = data.toString()
      console.log("[TUNNEL]:", output)

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("server-log", {
          type: "tunnel",
          level: "info",
          message: output,
          timestamp: new Date().toISOString(),
        })
      }

      const urlMatch = output.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i)
      if (urlMatch && !urlDetected) {
        tunnelUrl = urlMatch[1]
        urlDetected = true
        console.log(`🎉 Tunnel URL detected: ${tunnelUrl}`)

        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("tunnel-url-detected", tunnelUrl)
        }
      }
    })

    tunnelProcess.stderr.on("data", (data) => {
      const output = data.toString()
      console.log("[TUNNEL]:", output)

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("server-log", {
          type: "tunnel",
          level: "info",
          message: output,
          timestamp: new Date().toISOString(),
        })
      }

      const urlMatch = output.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i)
      if (urlMatch && !urlDetected) {
        tunnelUrl = urlMatch[1]
        urlDetected = true
        console.log(`🎉 Tunnel URL detected: ${tunnelUrl}`)

        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("tunnel-url-detected", tunnelUrl)
        }
      }
    })

    tunnelProcess.on("error", (error) => {
      console.error("❌ Tunnel process error:", error)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("server-log", {
          type: "tunnel",
          level: "error",
          message: `Tunnel error: ${error.message}`,
          timestamp: new Date().toISOString(),
        })
      }
    })

    // Don't wait for tunnel to fully start, just initiate it
    setTimeout(resolve, 2000)
  })
}

// App event listeners
app.whenReady().then(() => {
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  // Clean up processes
  if (databaseServerProcess) {
    console.log("🛑 Stopping database server...")
    databaseServerProcess.kill()
  }
  if (tunnelProcess) {
    console.log("🛑 Stopping tunnel process...")
    tunnelProcess.kill()
  }

  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  // Clean up processes before quitting
  if (databaseServerProcess) {
    console.log("🛑 Stopping database server...")
    databaseServerProcess.kill()
  }
  if (tunnelProcess) {
    console.log("🛑 Stopping tunnel process...")
    tunnelProcess.kill()
  }
})

ipcMain.handle("start-database-server", async () => {
  try {
    await startDatabaseServer()
    return { success: true, message: "Database server started successfully" }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle("start-tunnel", async () => {
  try {
    await startCloudflaredTunnel()
    return { success: true, message: "Tunnel started successfully" }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle("get-status", () => {
  const paths = getAppPaths()
  return {
    databaseServerRunning:
      databaseServerProcess !== null && databaseServerProcess !== undefined && !databaseServerProcess.killed,
    tunnelRunning: tunnelProcess !== null && tunnelProcess !== undefined && !tunnelProcess.killed,
    tunnelUrl: tunnelUrl,
    localUrl: `http://localhost:${PORTS.DATABASE_SERVER}`,
    networkUrl: `http://${getLocalNetworkIP()}:${PORTS.DATABASE_SERVER}`,
    databasePath: path.join(paths.databaseDir, "database.db"),
    serverScriptPath: paths.serverScript
  }
})

ipcMain.handle("stop-services", () => {
  if (databaseServerProcess) {
    databaseServerProcess.kill()
    databaseServerProcess = null
  }
  if (tunnelProcess) {
    tunnelProcess.kill()
    tunnelProcess = null
  }
  tunnelUrl = null
  return { success: true, message: "Services stopped" }
})