const express = require("express")
const router = express.Router()

// GET /api/items - Retrieve all items with optional filtering and pagination
router.get("/", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
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
      "item_no",
      "item_name",
      "brand",
      "item_type",
      "location",
      "balance",
      "min_stock",
      "deficit",
      "price_per_unit",
      "cost",
      "item_status",
      "last_po",
      "supplier",
    ]
    const validSortOrders = ["ASC", "DESC"]

    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : "item_no"
    const sortOrder = validSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : "ASC"

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
        item_no,
        item_name,
        brand,
        item_type,
        location,
        unit_of_measure,
        in_qty,
        out_qty,
        balance,
        min_stock,
        deficit,
        price_per_unit,
        cost,
        item_status,
        last_po,
        supplier
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
        search,
        item_type,
        location,
        item_status,
        sort_by: sortColumn,
        sort_order: sortOrder,
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
router.get("/:id", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const itemNo = Number.parseInt(req.params.id)

    if (isNaN(itemNo)) {
      return res.status(400).json({
        success: false,
        error: "Invalid item number",
      })
    }

    const item = await db.get(
      `
      SELECT 
        item_no,
        item_name,
        brand,
        item_type,
        location,
        unit_of_measure,
        in_qty,
        out_qty,
        balance,
        min_stock,
        deficit,
        price_per_unit,
        cost,
        item_status,
        last_po,
        supplier
      FROM itemsdb 
      WHERE item_no = ?
    `,
      [itemNo],
    )

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

// GET /api/items/dashboard/stats - Get dashboard statistics
router.get("/dashboard/stats", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
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

    // Get low stock items (top 10)
    const lowStockItems = await db.all(`
      SELECT item_no, item_name, balance, min_stock, deficit
      FROM itemsdb 
      WHERE item_status IN ('Low In Stock', 'Out Of Stock')
      ORDER BY deficit DESC
      LIMIT 10
    `)

    // Get high value items (top 10)
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

// GET /api/items/filters/options - Get filter options for dropdowns
router.get("/filters/options", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
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
        item_types: itemTypes.map((row) => row.item_type),
        locations: locations.map((row) => row.location),
        item_statuses: itemStatuses.map((row) => row.item_status),
        suppliers: suppliers.map((row) => row.supplier),
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

// POST /api/items - Create a new item
router.post("/", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const {
      item_name,
      brand = "",
      item_type = "",
      location = "",
      balance = 0,
      min_stock = 0,
      unit_of_measure = "",
      price_per_unit = 0,
      supplier = "",
    } = req.body

    // Validate required fields
    if (!item_name) {
      return res.status(400).json({
        success: false,
        error: "Item name is required",
      })
    }

    // For new items, set in_qty to achieve desired balance
    const in_qty = balance
    const out_qty = 0

    // Only insert base columns - let generated columns calculate automatically
    const result = await db.run(
      `
      INSERT INTO itemsdb (
        item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, min_stock, price_per_unit, supplier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        item_name,
        brand,
        item_type,
        location,
        unit_of_measure,
        in_qty,
        out_qty,
        min_stock,
        price_per_unit,
        supplier,
      ],
    )

    // Get the created item
    const newItem = await db.get(
      `
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?
    `,
      [result.lastID],
    )

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
router.put("/:id", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const itemNo = Number.parseInt(req.params.id)
    if (isNaN(itemNo)) {
      return res.status(400).json({
        success: false,
        error: "Invalid item number",
      })
    }

    // Check if item exists
    const existingItem = await db.get("SELECT * FROM itemsdb WHERE item_no = ?", [itemNo])
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      })
    }

    const {
      item_name,
      brand = "",
      item_type = "",
      location = "",
      balance = 0,
      min_stock = 0,
      unit_of_measure = "",
      price_per_unit = 0,
      supplier = "",
    } = req.body

    // Validate required fields
    if (!item_name) {
      return res.status(400).json({
        success: false,
        error: "Item name is required",
      })
    }

    // Calculate in_qty to achieve desired balance
    const in_qty = balance + existingItem.out_qty

    // Only update base columns - let generated columns calculate automatically
    await db.run(
      `
      UPDATE itemsdb SET
        item_name = ?, brand = ?, item_type = ?, location = ?, unit_of_measure = ?,
        in_qty = ?, min_stock = ?, price_per_unit = ?, supplier = ?
      WHERE item_no = ?
    `,
      [
        item_name,
        brand,
        item_type,
        location,
        unit_of_measure,
        in_qty,
        min_stock,
        price_per_unit,
        supplier,
        itemNo,
      ],
    )

    // Get the updated item
    const updatedItem = await db.get(
      `
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?
    `,
      [itemNo],
    )

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
router.delete("/:id", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const itemNo = Number.parseInt(req.params.id)
    if (isNaN(itemNo)) {
      return res.status(400).json({
        success: false,
        error: "Invalid item number",
      })
    }

    // Check if item exists
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

// PATCH /api/items/:id/stock - Update item stock (quick stock adjustment)
router.patch("/:id/stock", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const itemNo = Number.parseInt(req.params.id)
    if (isNaN(itemNo)) {
      return res.status(400).json({
        success: false,
        error: "Invalid item number",
      })
    }

    const { balance, adjustment_reason = "Manual adjustment" } = req.body

    if (typeof balance !== "number" || balance < 0) {
      return res.status(400).json({
        success: false,
        error: "Valid balance is required",
      })
    }

    // Check if item exists and get current data
    const existingItem = await db.get("SELECT * FROM itemsdb WHERE item_no = ?", [itemNo])
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      })
    }

    // To achieve the desired balance, we need to set in_qty = balance + out_qty
    const newInQty = balance + existingItem.out_qty

    // Only update base columns - let generated columns calculate automatically
    await db.run(
      `
      UPDATE itemsdb SET
        in_qty = ?
      WHERE item_no = ?
    `,
      [newInQty, itemNo],
    )

    // Get the updated item
    const updatedItem = await db.get(
      `
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?
    `,
      [itemNo],
    )

    res.json({
      success: true,
      data: updatedItem,
      message: "Stock updated successfully",
    })
  } catch (error) {
    console.error("Error updating stock:", error)
    res.status(500).json({
      success: false,
      error: "Failed to update stock",
      message: error.message,
    })
  }
})

// POST /api/items/bulk - Bulk create items (updated for generated columns)
router.post("/bulk", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const { items } = req.body

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Items array is required",
      })
    }

    const createdItems = []
    const errors = []

    // Process each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      try {
        const {
          item_name,
          brand = "",
          item_type = "",
          location = "",
          balance = 0,
          min_stock = 0,
          unit_of_measure = "",
          price_per_unit = 0,
          supplier = "",
        } = item

        if (!item_name) {
          errors.push({
            index: i,
            error: "Item name is required",
            item: item,
          })
          continue
        }

        // For new items, set in_qty to achieve desired balance
        const in_qty = balance
        const out_qty = 0

        const result = await db.run(
          `
          INSERT INTO itemsdb (
            item_name, brand, item_type, location, unit_of_measure,
            in_qty, out_qty, min_stock, price_per_unit, supplier
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            item_name,
            brand,
            item_type,
            location,
            unit_of_measure,
            in_qty,
            out_qty,
            min_stock,
            price_per_unit,
            supplier,
          ],
        )

        const newItem = await db.get(
          `
          SELECT 
            item_no, item_name, brand, item_type, location, unit_of_measure,
            in_qty, out_qty, balance, min_stock, deficit,
            price_per_unit, cost, item_status, last_po, supplier
          FROM itemsdb 
          WHERE item_no = ?
        `,
          [result.lastID],
        )

        createdItems.push(newItem)
      } catch (itemError) {
        errors.push({
          index: i,
          error: itemError.message,
          item: item,
        })
      }
    }

    res.status(201).json({
      success: true,
      data: {
        created_items: createdItems,
        errors: errors,
        summary: {
          total_attempted: items.length,
          successful: createdItems.length,
          failed: errors.length,
        },
      },
      message: `Bulk operation completed. ${createdItems.length} items created, ${errors.length} errors.`,
    })
  } catch (error) {
    console.error("Error in bulk create:", error)
    res.status(500).json({
      success: false,
      error: "Failed to bulk create items",
      message: error.message,
    })
  }
})

// POST /api/items/stock-insert - Insert stock for existing item
router.post("/:id/stock-insert", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const itemNo = Number.parseInt(req.params.id)
    if (isNaN(itemNo)) {
      return res.status(400).json({
        success: false,
        error: "Invalid item number",
      })
    }

    const { quantity, reason = "Stock insertion" } = req.body

    if (typeof quantity !== "number" || quantity <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid positive quantity is required",
      })
    }

    // Check if item exists and get current data
    const existingItem = await db.get("SELECT * FROM itemsdb WHERE item_no = ?", [itemNo])
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      })
    }

    const newInQty = existingItem.in_qty + quantity

    // Only update base columns - let generated columns calculate automatically
    await db.run(
      `
      UPDATE itemsdb SET
        in_qty = ?
      WHERE item_no = ?
    `,
      [newInQty, itemNo],
    )

    // Get the updated item
    const updatedItem = await db.get(
      `
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?
    `,
      [itemNo],
    )

    res.json({
      success: true,
      data: updatedItem,
      message: `Stock inserted successfully. Added ${quantity} units.`,
      stock_change: {
        previous_balance: existingItem.balance,
        added_quantity: quantity,
        new_balance: updatedItem.balance,
      },
    })
  } catch (error) {
    console.error("Error inserting stock:", error)
    res.status(500).json({
      success: false,
      error: "Failed to insert stock",
      message: error.message,
    })
  }
})

// GET /api/items/supplier/:supplier - Get items by supplier
router.get("/supplier/:supplier", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const supplier = decodeURIComponent(req.params.supplier)

    const items = await db.all(
      `
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE supplier = ?
      ORDER BY item_name
    `,
      [supplier],
    )

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

// GET /api/items/export/supplier-report/:supplier - Export supplier report with multiple sheets
router.get("/export/supplier-report/:supplier", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const supplier = decodeURIComponent(req.params.supplier)

    // Get all items for this supplier
    const allItems = await db.all(
      `
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE supplier = ?
      ORDER BY item_name
    `,
      [supplier],
    )

    // Categorize items
    const inStockItems = allItems.filter((item) => item.item_status === "In Stock")
    const lowStockItems = allItems.filter((item) => item.item_status === "Low In Stock")
    const outOfStockItems = allItems.filter((item) => item.item_status === "Out Of Stock")

    // For now, using items with high stock as placeholder until created_at is implemented
    const newlyAddedItems = allItems.filter((item) => item.balance > (item.min_stock || 10) * 2)

    // Create CSV headers
    const headers = [
      "Item No",
      "Item Name",
      "Brand",
      "Item Type",
      "Location",
      "Unit of Measure",
      "Balance",
      "Min Stock",
      "Deficit",
      "Price Per Unit",
      "Cost",
      "Status",
    ]

    // Function to convert items to CSV rows
    const itemsToCSV = (items, sheetName) => {
      const rows = [
        `=== ${sheetName.toUpperCase()} ===`,
        headers.join(","),
        ...items.map((item) =>
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
          ].join(","),
        ),
        "", // Empty line between sections
      ]
      return rows
    }

    // Combine all sections
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

    // Set response headers for file download
    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="supplier_report_${supplier.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.csv"`,
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

// GET /api/items/export/csv - Export items to CSV format
router.get("/export/csv", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    // Get all items
    const items = await db.all(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      ORDER BY item_no
    `)

    // Create CSV header
    const headers = [
      "Item No",
      "Item Name",
      "Brand",
      "Item Type",
      "Location",
      "Unit of Measure",
      "In Qty",
      "Out Qty",
      "Balance",
      "Min Stock",
      "Deficit",
      "Price Per Unit",
      "Cost",
      "Item Status",
      "Last PO",
      "Supplier",
    ]

    // Convert items to CSV rows
    const csvRows = [
      headers.join(","),
      ...items.map((item) =>
        [
          item.item_no,
          `"${(item.item_name || "").replace(/"/g, '""')}"`,
          `"${(item.brand || "").replace(/"/g, '""')}"`,
          `"${(item.item_type || "").replace(/"/g, '""')}"`,
          `"${(item.location || "").replace(/"/g, '""')}"`,
          `"${(item.unit_of_measure || "").replace(/"/g, '""')}"`,
          item.in_qty || 0,
          item.out_qty || 0,
          item.balance || 0,
          item.min_stock || 0,
          item.deficit || 0,
          item.price_per_unit || 0,
          item.cost || 0,
          `"${(item.item_status || "").replace(/"/g, '""')}"`,
          `"${(item.last_po || "").replace(/"/g, '""')}"`,
          `"${(item.supplier || "").replace(/"/g, '""')}"`,
        ].join(","),
      ),
    ]

    const csvContent = csvRows.join("\n")

    // Set response headers for file download
    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="inventory_export_${new Date().toISOString().split("T")[0]}.csv"`,
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

// GET /api/items/reports/inventory-summary - Generate inventory summary report
router.get("/reports/inventory-summary", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    // Get comprehensive statistics
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

    // Items by category
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

    // Items by location
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

    // Items by supplier
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

    // Critical items (out of stock or very low)
    const criticalItems = await db.all(`
      SELECT 
        item_no, item_name, brand, item_type, location,
        balance, min_stock, deficit, item_status
      FROM itemsdb
      WHERE item_status IN ('Out Of Stock', 'Low In Stock')
      ORDER BY deficit DESC, item_status DESC
      LIMIT 20
    `)

    // High-value items
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
