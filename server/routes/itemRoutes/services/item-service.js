// ==========================================
// routes/items/services/item-service.js - Business logic service
const { getDatabase } = require("../../config/database")

class ItemService {
  static async findById(itemNo) {
    const db = getDatabase()
    return await db.get(`
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      WHERE item_no = ?
    `, [itemNo])
  }

  static async findAll(filters = {}) {
    const db = getDatabase()
    const {
      limit = 50, offset = 0, search = "", item_type = "",
      location = "", item_status = "", sort_by = "item_no", sort_order = "ASC"
    } = filters

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

    const query = `
      SELECT 
        item_no, item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, balance, min_stock, deficit,
        price_per_unit, cost, item_status, last_po, supplier
      FROM itemsdb 
      ${whereClause}
      ORDER BY ${sort_by} ${sort_order}
      LIMIT ? OFFSET ?
    `

    return await db.all(query, [...params, limit, offset])
  }

  static async create(itemData) {
    const db = getDatabase()
    const {
      item_name, brand = "", item_type = "", location = "",
      balance = 0, min_stock = 0, unit_of_measure = "",
      price_per_unit = 0, supplier = ""
    } = itemData

    const in_qty = balance
    const out_qty = 0

    const result = await db.run(`
      INSERT INTO itemsdb (
        item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, min_stock, price_per_unit, supplier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [item_name, brand, item_type, location, unit_of_measure,
        in_qty, out_qty, min_stock, price_per_unit, supplier])

    return await this.findById(result.lastID)
  }

  static async update(itemNo, itemData) {
    const db = getDatabase()
    const existingItem = await this.findById(itemNo)
    
    if (!existingItem) {
      throw new Error("Item not found")
    }

    const {
      item_name, brand = "", item_type = "", location = "",
      balance = 0, min_stock = 0, unit_of_measure = "",
      price_per_unit = 0, supplier = ""
    } = itemData

    const in_qty = balance + existingItem.out_qty

    await db.run(`
      UPDATE itemsdb SET
        item_name = ?, brand = ?, item_type = ?, location = ?, unit_of_measure = ?,
        in_qty = ?, min_stock = ?, price_per_unit = ?, supplier = ?
      WHERE item_no = ?
    `, [item_name, brand, item_type, location, unit_of_measure,
        in_qty, min_stock, price_per_unit, supplier, itemNo])

    return await this.findById(itemNo)
  }

  static async delete(itemNo) {
    const db = getDatabase()
    const existingItem = await this.findById(itemNo)
    
    if (!existingItem) {
      throw new Error("Item not found")
    }

    await db.run("DELETE FROM itemsdb WHERE item_no = ?", [itemNo])
    return { item_no: itemNo }
  }

  static async adjustStock(itemNo, quantity, type = "add") {
    const db = getDatabase()
    const existingItem = await this.findById(itemNo)
    
    if (!existingItem) {
      throw new Error("Item not found")
    }

    let newInQty = existingItem.in_qty
    
    if (type === "add") {
      newInQty = existingItem.in_qty + quantity
    } else if (type === "set") {
      newInQty = quantity + existingItem.out_qty
    }

    await db.run(`
      UPDATE itemsdb SET in_qty = ? WHERE item_no = ?
    `, [newInQty, itemNo])

    return await this.findById(itemNo)
  }
}

module.exports = ItemService