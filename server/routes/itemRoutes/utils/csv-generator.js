// ==========================================
// routes/items/utils/csv-generator.js - CSV generation utility
const generateCSV = (headers, items) => {
  const csvRows = [
    headers.join(","),
    ...items.map(item =>
      headers.map(header => {
        const key = header.toLowerCase().replace(/\s+/g, "_")
        const value = item[key] || ""
        return typeof value === "string" 
          ? `"${value.replace(/"/g, '""')}"` 
          : value
      }).join(",")
    )
  ]
  return csvRows.join("\n")
}

module.exports = { generateCSV }