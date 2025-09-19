// ==========================================
// routes/items/items.js - Basic CRUD operations
const express = require("express")
const router = express.Router()
const { validateItem, validateItemId } = require("./validators")
const { getDatabase } = require("../../config/database")

// GET /api/items - Retrieve all items with optional filtering and pagination
router.get("/", async (req, res) => {
  try {
    const db = getDatabase()

    const {
      limit = 50,
      offset = 0,
      search = "",
      item_type = "",
      location = "",
      item_status = "",
      sort_by = "item_no",
      sort_order = "ASC",
    } = req.query

    // Validate sort parameters
    const validSortColumns = [
      "item_no", "item_name", "brand", "item_type", "location",
      "balance", "min_stock", "deficit", "price_per_unit", "cost",
      "item_status", "last_po", "supplier"
    ]
    const validSortOrders = ["ASC", "DESC"]

    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : "item_no"
    const sortOrder = validSortOrders.includes(sort_order.toUpperCase()) 
      ? sort_order.toUpperCase() : "ASC"

    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 50), 500)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    // Build WHERE clause for filtering
    let whereClause = "WHERE 1=1"
    const params = []

    if (search) {
      whereClause += " AND (item_name LIKE ? OR brand LIKE ? OR supplier LIKE ?)"
      const searchParam = `%${search}%`
      params.push(searchParam, searchParam, searchParam)
    }

    if (item_type) {
      whereClause += " AND item_type = ?"
      params.push(item_type)
    }

    if (location) {
      whereClause += " AND location = ?"
      params.push(location)
    }

    if (item_status) {
      whereClause += " AND item_status = ?"
      params.push(item_status)
    }

    // Get filtered data with pagination
    const query = `
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `

    const items = await db.all(query, [...params, parsedLimit, parsedOffset])

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as count FROM itemsdb ${whereClause}`
    const total = await db.get(countQuery, params)

    // Get summary statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN item_status = 'Out Of Stock' THEN 1 ELSE 0 END) as out_of_stock,
        SUM(CASE WHEN item_status = 'Low In Stock' THEN 1 ELSE 0 END) as low_stock,
        SUM(CASE WHEN item_status = 'In Stock' THEN 1 ELSE 0 END) as in_stock,
        SUM(cost) as total_inventory_value,
        SUM(balance) as total_items_count
      FROM itemsdb ${whereClause}
    `
    const stats = await db.get(statsQuery, params)

    res.json({
      success: true,
      data: items,
      pagination: {
        total: total.count,
        limit: parsedLimit,
        offset: parsedOffset,
        pages: Math.ceil(total.count / parsedLimit),
        current_page: Math.floor(parsedOffset / parsedLimit) + 1,
      },
      filters: {
        search, item_type, location, item_status,
        sort_by: sortColumn, sort_order: sortOrder,
      },
      statistics: stats,
    })
  } catch (error) {
    console.error("Error fetching items:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch items",
      message: error.message,
    })
  }
})

// GET /api/items/:id - Get a specific item by item_no
router.get("/:id", validateItemId, async (req, res) => {
  try {
    const db = getDatabase()
    const itemNo = Number.parseInt(req.params.id)

    const item = await db.get(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?
    `, [itemNo])

    if (!item) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      })
    }

    res.json({
      success: true,
      data: item,
    })
  } catch (error) {
    console.error("Error fetching item:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch item",
      message: error.message,
    })
  }
})

// POST /api/items - Create a new item
router.post("/", validateItem, async (req, res) => {
  try {
    const db = getDatabase()

    const {
      item_name, brand = "", item_type = "", location = "",
      balance = 0, min_stock = 0, unit_of_measure = "",
      price_per_unit = 0, supplier = ""
    } = req.body

    const in_qty = balance
    const out_qty = 0

    const result = await db.run(`
      INSERT INTO itemsdb (
        item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, min_stock, price_per_unit, supplier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, min_stock, price_per_unit, supplier])

    const newItem = await db.get(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?
    `, [result.lastID])

    res.status(201).json({
      success: true,
      data: newItem,
      message: "Item created successfully",
    })
  } catch (error) {
    console.error("Error creating item:", error)
    res.status(500).json({
      success: false,
      error: "Failed to create item",
      message: error.message,
    })
  }
})

// PUT /api/items/:id - Update an existing item
router.put("/:id", validateItemId, validateItem, async (req, res) => {
  try {
    const db = getDatabase()
    const itemNo = Number.parseInt(req.params.id)

    // Check if item exists
    const existingItem = await db.get("SELECT * FROM itemsdb WHERE item_no = ?", [itemNo])
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      })
    }

    const {
      item_name, brand = "", item_type = "", location = "",
      balance = 0, min_stock = 0, unit_of_measure = "",
      price_per_unit = 0, supplier = ""
    } = req.body

    const in_qty = balance + existingItem.out_qty

    await db.run(`
      UPDATE itemsdb SET
        item_name = ?, brand = ?, item_type = ?, location = ?, unit_of_measure = ?,
        in_qty = ?, min_stock = ?, price_per_unit = ?, supplier = ?
      WHERE item_no = ?
    `, [item_name, brand, item_type, location, unit_of_measure,
        in_qty, min_stock, price_per_unit, supplier, itemNo])

    const updatedItem = await db.get(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?
    `, [itemNo])

    res.json({
      success: true,
      data: updatedItem,
      message: "Item updated successfully",
    })
  } catch (error) {
    console.error("Error updating item:", error)
    res.status(500).json({
      success: false,
      error: "Failed to update item",
      message: error.message,
    })
  }
})

// DELETE /api/items/:id - Delete an item
router.delete("/:id", validateItemId, async (req, res) => {
  try {
    const db = getDatabase()
    const itemNo = Number.parseInt(req.params.id)

    const existingItem = await db.get("SELECT * FROM itemsdb WHERE item_no = ?", [itemNo])
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      })
    }

    await db.run("DELETE FROM itemsdb WHERE item_no = ?", [itemNo])

    res.json({
      success: true,
      message: "Item deleted successfully",
      data: { item_no: itemNo },
    })
  } catch (error) {
    console.error("Error deleting item:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete item",
      message: error.message,
    })
  }
})

// GET /api/items/filters/options - Get filter options for dropdowns
router.get("/filters/options", async (req, res) => {
  try {
    const db = getDatabase()

    const [itemTypes, locations, itemStatuses, suppliers] = await Promise.all([
      db.all("SELECT DISTINCT item_type FROM itemsdb WHERE item_type IS NOT NULL ORDER BY item_type"),
      db.all("SELECT DISTINCT location FROM itemsdb WHERE location IS NOT NULL ORDER BY location"),
      db.all("SELECT DISTINCT item_status FROM itemsdb ORDER BY item_status"),
      db.all("SELECT DISTINCT supplier FROM itemsdb WHERE supplier IS NOT NULL ORDER BY supplier"),
    ])

    res.json({
      success: true,
      data: {
        item_types: itemTypes.map(row => row.item_type),
        locations: locations.map(row => row.location),
        item_statuses: itemStatuses.map(row => row.item_status),
        suppliers: suppliers.map(row => row.supplier),
      },
    })
  } catch (error) {
    console.error("Error fetching filter options:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch filter options",
      message: error.message,
    })
  }
})

// GET /api/items/supplier/:supplier - Get items by supplier
router.get("/supplier/:supplier", async (req, res) => {
  try {
    const db = getDatabase()
    const supplier = decodeURIComponent(req.params.supplier)

    const items = await db.all(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE supplier = ?
      ORDER BY item_name
    `, [supplier])

    res.json({
      success: true,
      data: items,
      supplier: supplier,
      count: items.length,
    })
  } catch (error) {
    console.error("Error fetching items by supplier:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch items by supplier",
      message: error.message,
    })
  }
})

module.exports = router