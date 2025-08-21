// Terminal output handling
let terminalElement;
let statusElement;
let urlsContainer;
let startServerBtn;
let startTunnelBtn;
let stopServicesBtn;

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Initializing SQLite Tunnel Manager...");

  // Get DOM elements
  terminalElement = document.getElementById("terminal");
  statusElement = document.getElementById("status");
  urlsContainer = document.getElementById("urls-container");
  startServerBtn = document.getElementById("start-server");
  startTunnelBtn = document.getElementById("start-tunnel");
  stopServicesBtn = document.getElementById("stop-services");

  // Set up event listeners
  setupEventListeners();

  // Initial status check
  await updateStatus();

  // Auto-refresh status every 5 seconds
  setInterval(updateStatus, 5000);

  addTerminalLog("info", "✅ Application initialized successfully");

  async function updateStatus() {
  try {
    const status = await window.electronAPI.getStatus();

    // Update status indicators
    updateStatusIndicator(
      "database-status",
      status.databaseServerRunning,
      "Database Server"
    );
    updateStatusIndicator(
      "tunnel-status",
      status.tunnelRunning,
      "Cloudflare Tunnel"
    );

    // Update URLs
    updateUrls(status);

    // Update button states
    updateButtons(status);

    // Update database path
    if (status.databasePath) {
      const dbPathElement = document.getElementById("database-path");
      if (dbPathElement) {
        dbPathElement.textContent = status.databasePath;
      }
    }

    // Update local port - check if status has port info
    const portElement = document.getElementById("local-port");
    if (portElement && status.localUrl) {
      // Extract port from localUrl (e.g., "http://localhost:3001" -> "3001")
      const portMatch = status.localUrl.match(/:(\d+)/);
      if (portMatch) {
        portElement.textContent = portMatch[1];
      }
    }

    // Update server status in the info panel
    const serverStatusElement = document.getElementById("server-status");
    if (serverStatusElement) {
      const statusText = status.databaseServerRunning ? "Running" : "Stopped";
      serverStatusElement.textContent = statusText;

      // Add visual styling
      serverStatusElement.className = status.databaseServerRunning
        ? "info-value status-running"
        : "info-value status-stopped";
    }

    // Debug log to see what status contains
    console.log("Status object:", status);
  } catch (error) {
    addTerminalLog("error", `❌ Error updating status: ${error.message}`);
  }
}

});

function setupEventListeners() {
  // Button event listeners
  startServerBtn?.addEventListener("click", async () => {
    addTerminalLog("info", "🔄 Starting database server...");
    startServerBtn.disabled = true;
    startServerBtn.textContent = "Starting...";

    try {
      const result = await window.electronAPI.startDatabaseServer();
      if (result.success) {
        addTerminalLog("success", "✅ Database server started successfully");
      } else {
        addTerminalLog("error", `❌ Failed to start server: ${result.error}`);
      }
    } catch (error) {
      addTerminalLog("error", `❌ Error starting server: ${error.message}`);
    } finally {
      await updateStatus();
    }
  });

  startTunnelBtn?.addEventListener("click", async () => {
    addTerminalLog("info", "🔄 Starting Cloudflare tunnel...");
    startTunnelBtn.disabled = true;
    startTunnelBtn.textContent = "Starting...";

    try {
      const result = await window.electronAPI.startTunnel();
      if (result.success) {
        addTerminalLog("success", "✅ Tunnel started successfully");
      } else {
        addTerminalLog("error", `❌ Failed to start tunnel: ${result.error}`);
      }
    } catch (error) {
      addTerminalLog("error", `❌ Error starting tunnel: ${error.message}`);
    } finally {
      await updateStatus();
    }
  });

  stopServicesBtn?.addEventListener("click", async () => {
    addTerminalLog("info", "🔄 Stopping services...");
    stopServicesBtn.disabled = true;
    stopServicesBtn.textContent = "Stopping...";

    try {
      const result = await window.electronAPI.stopServices();
      if (result.success) {
        addTerminalLog("success", "✅ Services stopped successfully");
      } else {
        addTerminalLog("error", `❌ Failed to stop services: ${result.error}`);
      }
    } catch (error) {
      addTerminalLog("error", `❌ Error stopping services: ${error.message}`);
    } finally {
      await updateStatus();
    }
  });

  // Listen for server logs from main process
  window.electronAPI.onServerLog((event, logData) => {
    const { type, level, message, timestamp } = logData;

    // Format the message with source info
    const sourceLabel = type === "database-server" ? "[DATABASE]" : "[TUNNEL]";
    const formattedMessage = `${sourceLabel} ${message.trim()}`;

    addTerminalLog(
      level === "error" ? "error" : "info",
      formattedMessage,
      timestamp
    );
  });

  // Listen for tunnel URL detection
  window.electronAPI.onTunnelUrlDetected((event, url) => {
    addTerminalLog("success", `🎉 Tunnel URL detected: ${url}`);
    updateStatus(); // Refresh status to show the new URL
  });
}

async function updateStatus() {
  try {
    const status = await window.electronAPI.getStatus();

    // Update status indicators
    updateStatusIndicator(
      "database-status",
      status.databaseServerRunning,
      "Database Server"
    );
    updateStatusIndicator(
      "tunnel-status",
      status.tunnelRunning,
      "Cloudflare Tunnel"
    );

    // Update URLs
    updateUrls(status);

    // Update button states
    updateButtons(status);

    // Show additional info in terminal
    if (status.databasePath) {
      const dbPathElement = document.getElementById("database-path");
      if (dbPathElement) {
        dbPathElement.textContent = status.databasePath;
      }
    }
  } catch (error) {
    addTerminalLog("error", `❌ Error updating status: ${error.message}`);
  }
}

function updateStatusIndicator(elementId, isRunning, label) {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.className = `status-indicator ${isRunning ? "running" : "stopped"}`;
  element.textContent = `${label}: ${isRunning ? "Running" : "Stopped"}`;
}

function updateUrls(status) {
  if (!urlsContainer) return;

  urlsContainer.innerHTML = "";

  if (status.databaseServerRunning) {
    // Local URL
    addUrlCard(
      "Local Access",
      status.localUrl,
      "Only accessible from this computer"
    );

    // Network URL
    addUrlCard(
      "Network Access",
      status.networkUrl,
      "Accessible from devices on your network"
    );

    // Tunnel URL (if available)
    if (status.tunnelUrl) {
      addUrlCard(
        "Public Access",
        status.tunnelUrl,
        "Accessible from anywhere on the internet",
        true
      );
    }
  } else {
    urlsContainer.innerHTML =
      '<p class="no-urls">Start the database server to see access URLs</p>';
  }
}

function addUrlCard(title, url, description, isPublic = false) {
  const card = document.createElement("div");
  card.className = `url-card ${isPublic ? "public" : "local"}`;

  card.innerHTML = `
    <h3>${title}</h3>
    <div class="url-display">
      <input type="text" value="${url}" readonly class="url-input">
      <button class="copy-btn" onclick="copyToClipboard('${url}')">Copy</button>
    </div>
    <p class="url-description">${description}</p>
  `;

  urlsContainer.appendChild(card);
}

function updateButtons(status) {
  // Start Server button
  if (startServerBtn) {
    startServerBtn.disabled = status.databaseServerRunning;
    startServerBtn.textContent = status.databaseServerRunning
      ? "Server Running"
      : "Start Server";
  }

  // Start Tunnel button
  if (startTunnelBtn) {
    startTunnelBtn.disabled =
      !status.databaseServerRunning || status.tunnelRunning;
    startTunnelBtn.textContent = status.tunnelRunning
      ? "Tunnel Running"
      : "Start Tunnel";
  }

  // Stop Services button
  if (stopServicesBtn) {
    stopServicesBtn.disabled =
      !status.databaseServerRunning && !status.tunnelRunning;
    stopServicesBtn.textContent = "Stop Services";
  }
}

function addTerminalLog(level, message, timestamp = null) {
  if (!terminalElement) return;

  const logTime = timestamp
    ? new Date(timestamp).toLocaleTimeString()
    : new Date().toLocaleTimeString();
  const logEntry = document.createElement("div");
  logEntry.className = `terminal-line ${level}`;

  // Color coding for different log levels
  let color = "#ffffff";
  switch (level) {
    case "error":
      color = "#ff6b6b";
      break;
    case "success":
      color = "#51cf66";
      break;
    case "warning":
      color = "#ffd43b";
      break;
    case "info":
    default:
      color = "#74c0fc";
      break;
  }

  logEntry.innerHTML = `
    <span class="timestamp">[${logTime}]</span>
    <span class="message" style="color: ${color}">${message}</span>
  `;

  terminalElement.appendChild(logEntry);

  // Auto-scroll to bottom
  terminalElement.scrollTop = terminalElement.scrollHeight;

  // Limit terminal history (keep last 100 entries)
  const lines = terminalElement.children;
  if (lines.length > 100) {
    terminalElement.removeChild(lines[0]);
  }
}

function copyToClipboard(text) {
  if (window.electronAPI && window.electronAPI.copyToClipboard) {
    window.electronAPI.copyToClipboard(text);

    // Show feedback
    const event = document.createEvent("CustomEvent");
    event.initCustomEvent("show-toast", true, true, {
      message: "URL copied to clipboard!",
      type: "success",
    });
    document.dispatchEvent(event);

    addTerminalLog("success", `📋 Copied to clipboard: ${text}`);
  } else {
    // Fallback for browsers
    navigator.clipboard
      .writeText(text)
      .then(() => {
        addTerminalLog("success", `📋 Copied to clipboard: ${text}`);
      })
      .catch((err) => {
        addTerminalLog("error", `❌ Failed to copy: ${err.message}`);
      });
  }
}

// Clear terminal function
function clearTerminal() {
  if (terminalElement) {
    terminalElement.innerHTML = "";
    addTerminalLog("info", "🧹 Terminal cleared");
  }
}

// Export functions for use in HTML
window.copyToClipboard = copyToClipboard;
window.clearTerminal = clearTerminal;

// Handle application errors
window.addEventListener("error", (event) => {
  addTerminalLog("error", `❌ Application Error: ${event.message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  addTerminalLog("error", `❌ Unhandled Promise Rejection: ${event.reason}`);
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  // Remove event listeners
  if (window.electronAPI) {
    window.electronAPI.removeAllListeners("server-log");
    window.electronAPI.removeAllListeners("tunnel-url-detected");
  }
});
