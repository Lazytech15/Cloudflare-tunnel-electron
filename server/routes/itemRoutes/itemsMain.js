// routes/items/index.js - Main router file
const express = require("express")
const router = express.Router()

// Import sub-routers
const itemsRouter = require("./items")
const stockRouter = require("./stock")
const bulkRouter = require("./bulk")
const reportsRouter = require("./reports")
const exportRouter = require("./export")
const checkoutRouter = require("./checkout")

// Mount sub-routers
router.use("/", itemsRouter)
router.use("/stock", stockRouter)
router.use("/bulk", bulkRouter)
router.use("/reports", reportsRouter)
router.use("/export", exportRouter)
router.use("/checkout", checkoutRouter)

module.exports = router