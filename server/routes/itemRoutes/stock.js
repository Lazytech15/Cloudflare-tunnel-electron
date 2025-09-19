// ==========================================
// routes/items/stock.js - Stock management operations
const express = require("express")
const router = express.Router()
const { validateItemId, validateQuantity } = require("./validators")
const { getDatabase } = require("../../config/database")

// PATCH /api/items/stock/:id - Update item stock (quick stock adjustment)
router.patch("/:id", validateItemId, async (req, res) => {
  try {
    const db = getDatabase()
    const itemNo = Number.parseInt(req.params.id)
    const { balance, adjustment_reason = "Manual adjustment" } = req.body

    if (typeof balance !== "number" || balance < 0) {
      return res.status(400).json({
        success: false,
        error: "Valid balance is required",
      })
    }

    const existingItem = await db.get("SELECT * FROM itemsdb WHERE item_no = ?", [itemNo])
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      })
    }

    const newInQty = balance + existingItem.out_qty

    await db.run(`
      UPDATE itemsdb SET in_qty = ? WHERE item_no = ?
    `, [newInQty, itemNo])

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

// POST /api/items/stock/:id/insert - Insert stock for existing item
router.post("/:id/insert", validateItemId, async (req, res) => {
  try {
    const db = getDatabase()
    const itemNo = Number.parseInt(req.params.id)
    const { quantity, reason = "Stock insertion" } = req.body

    if (typeof quantity !== "number" || quantity <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid positive quantity is required",
      })
    }

    const existingItem = await db.get("SELECT * FROM itemsdb WHERE item_no = ?", [itemNo])
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      })
    }

    const newInQty = existingItem.in_qty + quantity

    await db.run(`
      UPDATE itemsdb SET in_qty = ? WHERE item_no = ?
    `, [newInQty, itemNo])

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

// PUT /api/items/stock/:id/quantity - For direct quantity updates
router.put("/:id/quantity", validateItemId, async (req, res) => {
  try {
    const db = getDatabase()
    const itemNo = req.params.id
    const { in_qty, out_qty, balance, update_type, notes, updated_by } = req.body

    if (in_qty === undefined && out_qty === undefined && balance === undefined) {
      return res.status(400).json({
        success: false,
        error: "At least one quantity field (in_qty, out_qty, or balance) must be provided"
      })
    }

    const currentItem = await db.get(
      `SELECT item_no, item_name, in_qty, out_qty, balance FROM itemsdb WHERE item_no = ?`,
      [itemNo]
    )

    if (!currentItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found"
      })
    }

    let newInQty = currentItem.in_qty
    let newOutQty = currentItem.out_qty
    let newBalance = currentItem.balance

    if (update_type === "set_balance" && balance !== undefined) {
      if (balance < 0) {
        return res.status(400).json({
          success: false,
          error: "Balance cannot be negative"
        })
      }
      newBalance = balance
    } else if (update_type === "adjust_in" && in_qty !== undefined) {
      if (in_qty < 0) {
        return res.status(400).json({
          success: false,
          error: "In quantity cannot be negative"
        })
      }
      newInQty = in_qty
      newBalance = newInQty - newOutQty
    } else if (update_type === "adjust_out" && out_qty !== undefined) {
      if (out_qty < 0) {
        return res.status(400).json({
          success: false,
          error: "Out quantity cannot be negative"
        })
      }
      newOutQty = out_qty
      newBalance = newInQty - newOutQty
    } else {
      if (in_qty !== undefined) {
        if (in_qty < 0) {
          return res.status(400).json({
            success: false,
            error: "In quantity cannot be negative"
          })
        }
        newInQty = in_qty
      }
      
      if (out_qty !== undefined) {
        if (out_qty < 0) {
          return res.status(400).json({
            success: false,
            error: "Out quantity cannot be negative"
          })
        }
        newOutQty = out_qty
      }
      
      if (balance !== undefined) {
        if (balance < 0) {
          return res.status(400).json({
            success: false,
            error: "Balance cannot be negative"
          })
        }
        newBalance = balance
      } else {
        newBalance = newInQty - newOutQty
      }
    }

    if (newBalance < 0) {
      return res.status(400).json({
        success: false,
        error: "Calculated balance would be negative. Please check your quantities."
      })
    }

    await db.run(
      `UPDATE itemsdb SET in_qty = ?, out_qty = ?, balance = ? WHERE item_no = ?`,
      [newInQty, newOutQty, newBalance, itemNo]
    )

    const updatedItem = await db.get(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?`,
      [itemNo]
    )

    res.json({
      success: true,
      message: "Item quantities updated successfully",
      data: {
        item: updatedItem,
        changes: {
          previous: {
            in_qty: currentItem.in_qty,
            out_qty: currentItem.out_qty,
            balance: currentItem.balance
          },
          updated: {
            in_qty: newInQty,
            out_qty: newOutQty,
            balance: newBalance
          },
          update_type: update_type || "manual",
          notes: notes || null,
          updated_by: updated_by || null,
          timestamp: new Date().toISOString()
        }
      }
    })
  } catch (error) {
    console.error("Error updating item quantities:", error)
    res.status(500).json({
      success: false,
      error: "Failed to update item quantities",
      message: error.message
    })
  }
})

// POST /api/items/stock/:id/out - For recording items going out
router.post("/:id/out", validateItemId, async (req, res) => {
  try {
    const db = getDatabase()
    const itemNo = req.params.id
    const { quantity, notes, out_by } = req.body

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        error: "Quantity must be a positive number"
      })
    }

    const currentItem = await db.get(
      `SELECT item_no, item_name, balance, out_qty FROM itemsdb WHERE item_no = ?`,
      [itemNo]
    )

    if (!currentItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found"
      })
    }

    if (currentItem.balance < quantity) {
      return res.status(400).json({
        success: false,
        error: `Insufficient stock. Available: ${currentItem.balance}, Requested: ${quantity}`
      })
    }

    const newOutQty = (currentItem.out_qty || 0) + quantity
    const newBalance = currentItem.balance - quantity

    await db.run(
      `UPDATE itemsdb SET out_qty = ?, balance = ? WHERE item_no = ?`,
      [newOutQty, newBalance, itemNo]
    )

    const updatedItem = await db.get(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?`,
      [itemNo]
    )

    res.json({
      success: true,
      message: "Item out quantity recorded successfully",
      data: {
        item: updatedItem,
        transaction: {
          quantity_out: quantity,
          previous_balance: currentItem.balance,
          new_balance: newBalance,
          notes: notes || null,
          out_by: out_by || null,
          timestamp: new Date().toISOString()
        }
      }
    })
  } catch (error) {
    console.error("Error recording item out:", error)
    res.status(500).json({
      success: false,
      error: "Failed to record item out",
      message: error.message
    })
  }
})

module.exports = router