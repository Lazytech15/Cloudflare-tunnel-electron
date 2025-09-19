// ==========================================
// routes/items/bulk.js - Bulk operations
const express = require("express")
const router = express.Router()
const { getDatabase } = require("../../config/database")

// POST /api/items/bulk - Bulk create items
router.post("/", async (req, res) => {
  try {
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

    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      try {
        const {
          item_name, brand = "", item_type = "", location = "",
          balance = 0, min_stock = 0, unit_of_measure = "",
          price_per_unit = 0, supplier = ""
        } = item

        if (!item_name) {
          errors.push({
            index: i,
            error: "Item name is required",
            item: item,
          })
          continue
        }

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

module.exports = router