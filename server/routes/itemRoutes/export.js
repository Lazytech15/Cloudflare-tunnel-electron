// ==========================================
// routes/items/export.js - Export operations
const express = require("express")
const router = express.Router()
const { getDatabase } = require("../../config/database")
const { generateCSV } = require("./utils/csv-generator")

// GET /api/items/export/csv - Export items to CSV format
router.get("/csv", async (req, res) => {
  try {
    const db = getDatabase()

    const items = await db.all(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      ORDER BY item_no
    `)

    const headers = [
      "Item No", "Item Name", "Brand", "Item Type", "Location",
      "Unit of Measure", "In Qty", "Out Qty", "Balance", "Min Stock",
      "Deficit", "Price Per Unit", "Cost", "Item Status", "Last PO", "Supplier"
    ]

    const csvContent = generateCSV(headers, items)

    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="inventory_export_${new Date().toISOString().split("T")[0]}.csv"`
    )

    res.send(csvContent)
  } catch (error) {
    console.error("Error exporting CSV:", error)
    res.status(500).json({
      success: false,
      error: "Failed to export CSV",
      message: error.message,
    })
  }
})

// GET /api/items/export/supplier-report/:supplier - Export supplier report
router.get("/supplier-report/:supplier", async (req, res) => {
  try {
    const db = getDatabase()
    const supplier = decodeURIComponent(req.params.supplier)

    const allItems = await db.all(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE supplier = ?
      ORDER BY item_name
    `, [supplier])

    const inStockItems = allItems.filter(item => item.item_status === "In Stock")
    const lowStockItems = allItems.filter(item => item.item_status === "Low In Stock")
    const outOfStockItems = allItems.filter(item => item.item_status === "Out Of Stock")
    const newlyAddedItems = allItems.filter(item => item.balance > (item.min_stock || 10) * 2)

    const headers = [
      "Item No", "Item Name", "Brand", "Item Type", "Location",
      "Unit of Measure", "Balance", "Min Stock", "Deficit",
      "Price Per Unit", "Cost", "Status"
    ]

    const itemsToCSV = (items, sheetName) => {
      const rows = [
        `=== ${sheetName.toUpperCase()} ===`,
        headers.join(","),
        ...items.map(item =>
          [
            item.item_no,
            `"${(item.item_name || "").replace(/"/g, '""')}"`,
            `"${(item.brand || "").replace(/"/g, '""')}"`,
            `"${(item.item_type || "").replace(/"/g, '""')}"`,
            `"${(item.location || "").replace(/"/g, '""')}"`,
            `"${(item.unit_of_measure || "").replace(/"/g, '""')}"`,
            item.balance || 0,
            item.min_stock || 0,
            item.deficit || 0,
            item.price_per_unit || 0,
            item.cost || 0,
            `"${(item.item_status || "").replace(/"/g, '""')}"`,
          ].join(",")
        ),
        ""
      ]
      return rows
    }

    const csvSections = [
      [`=== SUPPLIER REPORT: ${supplier.toUpperCase()} ===`],
      [`Generated on: ${new Date().toISOString().split("T")[0]}`],
      [`Total Items: ${allItems.length}`],
      [""],
      ...itemsToCSV(inStockItems, "IN STOCK ITEMS"),
      ...itemsToCSV(lowStockItems, "LOW STOCK ITEMS"),
      ...itemsToCSV(outOfStockItems, "OUT OF STOCK ITEMS"),
      ...itemsToCSV(newlyAddedItems, "NEWLY ADDED STOCK ITEMS"),
    ]

    const csvContent = csvSections.flat().join("\n")

    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="supplier_report_${supplier.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.csv"`
    )

    res.send(csvContent)
  } catch (error) {
    console.error("Error exporting supplier report:", error)
    res.status(500).json({
      success: false,
      error: "Failed to export supplier report",
      message: error.message,
    })
  }
})

module.exports = router