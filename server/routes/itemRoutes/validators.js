// ==========================================
// routes/items/validators.js - Validation middleware
const validateItemId = (req, res, next) => {
  const itemNo = Number.parseInt(req.params.id)
  if (isNaN(itemNo)) {
    return res.status(400).json({
      success: false,
      error: "Invalid item number",
    })
  }
  next()
}

const validateItem = (req, res, next) => {
  const { item_name } = req.body
  if (!item_name) {
    return res.status(400).json({
      success: false,
      error: "Item name is required",
    })
  }
  next()
}

const validateQuantity = (req, res, next) => {
  const { quantity } = req.body
  if (!quantity || quantity <= 0) {
    return res.status(400).json({
      success: false,
      error: "Valid positive quantity is required",
    })
  }
  next()
}

module.exports = {
  validateItemId,
  validateItem,
  validateQuantity
}