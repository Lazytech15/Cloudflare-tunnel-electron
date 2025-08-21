const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  startDatabaseServer: () => ipcRenderer.invoke("start-database-server"),
  startTunnel: () => ipcRenderer.invoke("start-tunnel"),
  getStatus: () => ipcRenderer.invoke("get-status"),
  stopServices: () => ipcRenderer.invoke("stop-services"),

  copyToClipboard: (text) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        console.log("[v0] Text copied to clipboard:", text)
      })
      .catch((err) => {
        console.error("[v0] Failed to copy text:", err)
      })
  },

  // Event listeners
  onServerLog: (callback) => ipcRenderer.on("server-log", callback),
  onTunnelUrlDetected: (callback) => ipcRenderer.on("tunnel-url-detected", callback),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
})
