// ==========================================
// routes/items/reports.js - Reporting operations
const express = require("express")
const router = express.Router()
const { getDatabase } = require("../../config/database")

// GET /api/items/reports/dashboard/stats - Get dashboard statistics
router.get("/dashboard/stats", async (req, res) => {
  try {
    const db = getDatabase()

    const stats = await db.get(`
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN item_status = 'Out Of Stock' THEN 1 ELSE 0 END) as out_of_stock_count,
        SUM(CASE WHEN item_status = 'Low In Stock' THEN 1 ELSE 0 END) as low_stock_count,
        SUM(CASE WHEN item_status = 'In Stock' THEN 1 ELSE 0 END) as in_stock_count,
        ROUND(SUM(cost), 2) as total_inventory_value,
        SUM(balance) as total_quantity,
        ROUND(AVG(price_per_unit), 2) as avg_price_per_unit,
        COUNT(DISTINCT item_type) as total_categories,
        COUNT(DISTINCT location) as total_locations,
        COUNT(DISTINCT supplier) as total_suppliers
      FROM itemsdb
    `)

    const lowStockItems = await db.all(`
      SELECT item_no, item_name, balance, min_stock, deficit
      FROM itemsdb 
      WHERE item_status IN ('Low In Stock', 'Out Of Stock')
      ORDER BY deficit DESC
      LIMIT 10
    `)

    const highValueItems = await db.all(`
      SELECT item_no, item_name, balance, price_per_unit, cost
      FROM itemsdb 
      ORDER BY cost DESC
      LIMIT 10
    `)

    res.json({
      success: true,
      data: {
        overview: stats,
        low_stock_items: lowStockItems,
        high_value_items: highValueItems,
      },
    })
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard statistics",
      message: error.message,
    })
  }
})

// GET /api/items/reports/inventory-summary - Generate inventory summary report
router.get("/inventory-summary", async (req, res) => {
  try {
    const db = getDatabase()

    const overview = await db.get(`
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN item_status = 'Out Of Stock' THEN 1 ELSE 0 END) as out_of_stock_count,
        SUM(CASE WHEN item_status = 'Low In Stock' THEN 1 ELSE 0 END) as low_stock_count,
        SUM(CASE WHEN item_status = 'In Stock' THEN 1 ELSE 0 END) as in_stock_count,
        ROUND(SUM(cost), 2) as total_inventory_value,
        SUM(balance) as total_quantity,
        ROUND(AVG(price_per_unit), 2) as avg_price_per_unit,
        COUNT(DISTINCT item_type) as total_categories,
        COUNT(DISTINCT location) as total_locations,
        COUNT(DISTINCT supplier) as total_suppliers
      FROM itemsdb
    `)

    const byCategory = await db.all(`
      SELECT 
        item_type,
        COUNT(*) as item_count,
        SUM(balance) as total_quantity,
        ROUND(SUM(cost), 2) as total_value
      FROM itemsdb
      WHERE item_type IS NOT NULL AND item_type != ''
      GROUP BY item_type
      ORDER BY total_value DESC
    `)

    const byLocation = await db.all(`
      SELECT 
        location,
        COUNT(*) as item_count,
        SUM(balance) as total_quantity,
        ROUND(SUM(cost), 2) as total_value
      FROM itemsdb
      WHERE location IS NOT NULL AND location != ''
      GROUP BY location
      ORDER BY total_value DESC
    `)

    const bySupplier = await db.all(`
      SELECT 
        supplier,
        COUNT(*) as item_count,
        SUM(balance) as total_quantity,
        ROUND(SUM(cost), 2) as total_value
      FROM itemsdb
      WHERE supplier IS NOT NULL AND supplier != ''
      GROUP BY supplier
      ORDER BY total_value DESC
    `)

    const criticalItems = await db.all(`
      SELECT 
        item_no, item_name, brand, item_type, location,
        balance, min_stock, deficit, item_status
      FROM itemsdb
      WHERE item_status IN ('Out Of Stock', 'Low In Stock')
      ORDER BY deficit DESC, item_status DESC
      LIMIT 20
    `)

    const highValueItems = await db.all(`
      SELECT 
        item_no, item_name, brand, balance,
        price_per_unit, cost, item_status
      FROM itemsdb
      ORDER BY cost DESC
      LIMIT 10
    `)

    res.json({
      success: true,
      data: {
        overview,
        breakdown: {
          by_category: byCategory,
          by_location: byLocation,
          by_supplier: bySupplier,
        },
        critical_items: criticalItems,
        high_value_items: highValueItems,
        generated_at: new Date().toISOString(),
      },
      message: "Inventory summary report generated successfully",
    })
  } catch (error) {
    console.error("Error generating inventory summary:", error)
    res.status(500).json({
      success: false,
      error: "Failed to generate inventory summary",
      message: error.message,
    })
  }
})

module.exports = router