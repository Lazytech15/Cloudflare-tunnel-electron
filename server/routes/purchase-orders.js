const express = require("express")
const router = express.Router()

// GET /api/purchase-orders - Retrieve all purchase orders with optional filtering
router.get("/", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const {
      limit = 50,
      offset = 0,
      status = "",
      supplier = "",
      sort_by = "order_date",
      sort_order = "DESC",
    } = req.query

    // Validate sort parameters
    const validSortColumns = [
      "id",
      "supplier",
      "status",
      "order_date",
      "expected_delivery_date",
      "actual_delivery_date",
      "total_value",
      "priority",
      "last_updated"
    ]
    const validSortOrders = ["ASC", "DESC"]

    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : "order_date"
    const sortOrder = validSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : "DESC"

    const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit) || 50), 500)
    const parsedOffset = Math.max(0, Number.parseInt(offset) || 0)

    // Build WHERE clause for filtering
    let whereClause = "WHERE 1=1"
    const params = []

    if (status) {
      whereClause += " AND status = ?"
      params.push(status)
    }

    if (supplier) {
      whereClause += " AND supplier LIKE ?"
      params.push(`%${supplier}%`)
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM purchase_orders ${whereClause}`
    const totalResult = await db.get(countQuery, params)
    const total = totalResult.total

    // Get purchase orders
    const query = `
      SELECT * FROM purchase_orders
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `
    params.push(parsedLimit, parsedOffset)

    const orders = await db.all(query, params)

    // Get items for each order
    for (const order of orders) {
      const items = await db.all(
        "SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY item_no",
        [order.id]
      )
      order.items = items
    }

    res.json({
      success: true,
      data: orders,
      pagination: {
        total,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + parsedLimit < total
      }
    })
  } catch (error) {
    console.error("Error fetching purchase orders:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch purchase orders",
      error: error.message
    })
  }
})

// GET /api/purchase-orders/:id - Retrieve a specific purchase order
router.get("/:id", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()
    const { id } = req.params

    const order = await db.get("SELECT * FROM purchase_orders WHERE id = ?", [id])

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Purchase order not found"
      })
    }

    // Get items for the order
    const items = await db.all(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY item_no",
      [id]
    )
    order.items = items

    res.json({
      success: true,
      data: order
    })
  } catch (error) {
    console.error("Error fetching purchase order:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch purchase order",
      error: error.message
    })
  }
})

// POST /api/purchase-orders - Create a new purchase order
router.post("/", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()

    const {
      supplier,
      items,
      expected_delivery_date,
      notes,
      priority = "normal",
      created_by
    } = req.body

    // Validate required fields
    if (!supplier || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Supplier and items are required"
      })
    }

    // Generate order ID (PO-YYYY-NNN)
    const currentYear = new Date().getFullYear()
    const prefix = `PO-${currentYear}-`

    // Get the next number
    const lastOrder = await db.get(
      "SELECT id FROM purchase_orders WHERE id LIKE ? ORDER BY id DESC LIMIT 1",
      [`${prefix}%`]
    )

    let nextNumber = 1
    if (lastOrder) {
      const lastNumber = parseInt(lastOrder.id.split('-')[2])
      nextNumber = lastNumber + 1
    }

    const orderId = `${prefix}${nextNumber.toString().padStart(3, '0')}`
    const orderDate = new Date().toISOString().split('T')[0]

    // Calculate totals
    let totalItems = items.length
    let totalQuantity = 0
    let totalValue = 0

    for (const item of items) {
      totalQuantity += item.quantity || 0
      totalValue += (item.quantity || 0) * (item.unit_price || 0)
    }

    // Insert purchase order
    await db.run(`
      INSERT INTO purchase_orders (
        id, supplier, status, order_date, expected_delivery_date,
        total_items, total_quantity, total_value, notes, priority, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      orderId, supplier, "ordered", orderDate, expected_delivery_date,
      totalItems, totalQuantity, totalValue, notes, priority, created_by
    ])

    // Insert order items
    for (const item of items) {
      await db.run(`
        INSERT INTO purchase_order_items (
          purchase_order_id, item_no, item_name, quantity, unit_price, status
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        orderId, item.item_no, item.item_name, item.quantity, item.unit_price, "ordered"
      ])
    }

    // Get the created order with items
    const createdOrder = await db.get("SELECT * FROM purchase_orders WHERE id = ?", [orderId])
    const createdItems = await db.all(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY item_no",
      [orderId]
    )
    createdOrder.items = createdItems

    res.status(201).json({
      success: true,
      message: "Purchase order created successfully",
      data: createdOrder
    })
  } catch (error) {
    console.error("Error creating purchase order:", error)
    res.status(500).json({
      success: false,
      message: "Failed to create purchase order",
      error: error.message
    })
  }
})

// PUT /api/purchase-orders/:id/status - Update purchase order status
router.put("/:id/status", async (req, res) => {
  try {
    const { getDatabase } = require("../config/database")
    const db = getDatabase()
    const { id } = req.params
    const { new_status, notes, actual_delivery_date } = req.body

    // Validate status
    const validStatuses = ['requested', 'ordered', 'in_transit', 'ready_for_pickup', 'received', 'cancelled']
    if (!validStatuses.includes(new_status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status"
      })
    }

    // Check if order exists
    const order = await db.get("SELECT * FROM purchase_orders WHERE id = ?", [id])
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Purchase order not found"
      })
    }

    // Update order status
    const updateFields = ["status = ?", "last_updated = CURRENT_TIMESTAMP"]
    const updateParams = [new_status]

    if (actual_delivery_date && new_status === 'received') {
      updateFields.push("actual_delivery_date = ?")
      updateParams.push(actual_delivery_date)
    }

    const updateQuery = `
      UPDATE purchase_orders
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `
    updateParams.push(id)

    await db.run(updateQuery, updateParams)

    // If status changed to received, update item statuses
    if (new_status === 'received') {
      await db.run(
        "UPDATE purchase_order_items SET status = 'received' WHERE purchase_order_id = ?",
        [id]
      )
    }

    // Log the status change if notes provided
    if (notes) {
      // You might want to create an admin_logs entry here
      console.log(`Purchase order ${id} status changed to ${new_status}: ${notes}`)
    }

    // Get updated order
    const updatedOrder = await db.get("SELECT * FROM purchase_orders WHERE id = ?", [id])
    const items = await db.all(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY item_no",
      [id]
    )
    updatedOrder.items = items

    res.json({
      success: true,
      message: "Purchase order status updated successfully",
      data: updatedOrder
    })
  } catch (error) {
    console.error("Error updating purchase order status:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update purchase order status",
      error: error.message
    })
  }
})

module.exports = router