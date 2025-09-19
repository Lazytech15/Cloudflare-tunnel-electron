// ==========================================
// routes/items/checkout.js - Checkout operations
const express = require("express")
const router = express.Router()
const { getDatabase } = require("../../config/database")

// POST /api/items/checkout - For processing checkout transactions
router.post("/", async (req, res) => {
  try {
    const db = getDatabase()
    const { items, checkout_by, notes } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid input: items array is required and cannot be empty"
      })
    }

    for (const item of items) {
      if (!item.item_no || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: "Each item must have item_no and positive quantity"
        })
      }
    }

    await db.run("BEGIN TRANSACTION")

    try {
      const checkoutResults = []
      const timestamp = new Date().toISOString()

      for (const item of items) {
        const { item_no, quantity } = item

        const currentItem = await db.get(
          `SELECT item_no, item_name, balance, out_qty FROM itemsdb WHERE item_no = ?`,
          [item_no]
        )

        if (!currentItem) {
          throw new Error(`Item ${item_no} not found`)
        }

        if (currentItem.balance < quantity) {
          throw new Error(`Insufficient stock for item ${item_no}. Available: ${currentItem.balance}, Requested: ${quantity}`)
        }

        const newOutQty = (currentItem.out_qty || 0) + quantity
        const newBalance = currentItem.balance - quantity

        await db.run(
          `UPDATE itemsdb SET out_qty = ?, balance = ? WHERE item_no = ?`,
          [newOutQty, newBalance, item_no]
        )

        checkoutResults.push({
          item_no: item_no,
          item_name: currentItem.item_name,
          quantity_checked_out: quantity,
          previous_balance: currentItem.balance,
          new_balance: newBalance
        })
      }

      await db.run("COMMIT")

      res.json({
        success: true,
        message: "Checkout processed successfully",
        data: {
          checkout_timestamp: timestamp,
          checkout_by: checkout_by || null,
          notes: notes || null,
          items: checkoutResults
        }
      })

    } catch (error) {
      await db.run("ROLLBACK")
      throw error
    }

  } catch (error) {
    console.error("Error processing checkout:", error)
    res.status(500).json({
      success: false,
      error: "Failed to process checkout",
      message: error.message
    })
  }
})

module.exports = router