"use client"

import { useState, useEffect } from "react"
import axios from "axios"

function App() {
  const [serverInfo, setServerInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchServerInfo()
  }, [])

  const fetchServerInfo = async () => {
    try {
      setLoading(true)
      const response = await axios.get("/api/health")
      setServerInfo(response.data)
      setError(null)
    } catch (err) {
      setError("Failed to connect to database server")
      console.error("Error fetching server info:", err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <h2>🔄 Loading Database Server...</h2>
          <p>Connecting to your database...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h2>❌ Connection Error</h2>
          <p>{error}</p>
          <button
            onClick={fetchServerInfo}
            style={{
              marginTop: "10px",
              padding: "8px 16px",
              background: "#fff",
              color: "#000",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  const baseUrl = window.location.origin

  return (
    <div className="container">
      <div className="header">
        <h1>🗃️ Easy Access Database</h1>
        <p className="status">✅ Database server is running and ready!</p>
        <p>Your database is now publicly accessible through this REST API.</p>
      </div>

      {serverInfo && (
        <div className="info">
          <h3>🔧 Server Information</h3>
          <p>
            <strong>Status:</strong> <span className="status">{serverInfo.status}</span>
          </p>
          <p>
            <strong>Database:</strong> {serverInfo.database}
          </p>
          <p>
            <strong>Environment:</strong> {serverInfo.environment}
          </p>
          <p>
            <strong>Database Location:</strong> {serverInfo.databaseDir}/database.db
          </p>
          <p>
            <strong>Server Started:</strong> {new Date(serverInfo.timestamp).toLocaleString()}
          </p>
          <p>
            <strong>Node.js Version:</strong> {serverInfo.processInfo?.execPath ? "Available" : "N/A"}
          </p>
          <p>
            <strong>Process ID:</strong> {serverInfo.processInfo?.pid}
          </p>
        </div>
      )}

      <div className="section">
        <h2>🔗 Available Endpoints</h2>

        <div className="endpoint">
          <span className="method">GET</span> <span className="url">/api/health</span>
          <br />
          <strong>Description:</strong> Check if the database server is running and healthy
        </div>

        <div className="endpoint">
          <span className="method">GET</span> <span className="url">/api/tables</span>
          <br />
          <strong>Description:</strong> Get a list of all tables in the database
        </div>

        <div className="endpoint">
          <span className="method">GET</span> <span className="url">/api/tables/{"{tableName}"}/schema</span>
          <br />
          <strong>Description:</strong> Get schema information for a specific table
        </div>

        <div className="endpoint">
          <span className="method">GET</span> <span className="url">/api/tables/{"{tableName}"}/data</span>
          <br />
          <strong>Description:</strong> Get all records from a table
          <br />
          <strong>Query Parameters:</strong> <code>?limit=100&offset=0</code>
        </div>

        <div className="endpoint">
          <span className="method">POST</span> <span className="url">/api/tables/{"{tableName}"}/data</span>
          <br />
          <strong>Description:</strong> Insert a new record into a table
          <br />
          <strong>Body:</strong> JSON object with field values
        </div>

        <div className="endpoint">
          <span className="method">PUT</span>{" "}
          <span className="url">
            /api/tables/{"{tableName}"}/data/{"{id}"}
          </span>
          <br />
          <strong>Description:</strong> Update an existing record by ID
          <br />
          <strong>Body:</strong> JSON object with updated field values
        </div>

        <div className="endpoint">
          <span className="method">DELETE</span>{" "}
          <span className="url">
            /api/tables/{"{tableName}"}/data/{"{id}"}
          </span>
          <br />
          <strong>Description:</strong> Delete a record by ID
        </div>

        <div className="endpoint">
          <span className="method">POST</span> <span className="url">/api/query</span>
          <br />
          <strong>Description:</strong> Execute custom SQL queries
          <br />
          <strong>Body:</strong> <code>{`{"sql": "SELECT * FROM table", "params": []}`}</code>
        </div>
      </div>

      <div className="section">
        <h2>📝 Example Usage</h2>
        <pre>{`# Health check
curl ${baseUrl}/api/health

# Get all tables
curl ${baseUrl}/api/tables

# Get sample data
curl "${baseUrl}/api/tables/sample_data/data?limit=10"

# Insert new record
curl -X POST ${baseUrl}/api/tables/sample_data/data \\
  -H "Content-Type: application/json" \\
  -d '{"name": "New Entry", "value": "New Value"}'

# Custom query
curl -X POST ${baseUrl}/api/query \\
  -H "Content-Type: application/json" \\
  -d '{"sql": "SELECT * FROM sample_data WHERE name LIKE ?", "params": ["%Entry%"]}'`}</pre>
      </div>

      <div className="section">
        <h2>🛡️ Security Notes</h2>
        <ul>
          <li>This API includes basic SQL injection protection</li>
          <li>Table names are validated using regex patterns</li>
          <li>Dangerous SQL keywords are filtered in custom queries</li>
          <li>Consider implementing authentication for production use</li>
        </ul>
      </div>
    </div>
  )
}

export default App
