const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/dashboard', async (req, res) => {
  try {
    const totalOrders = (await db.one(`SELECT COUNT(*)::int c FROM orders`)).c;
    const activeOrders = (await db.one(`SELECT COUNT(*)::int c FROM orders WHERE status != 'delivered'`)).c;
    const readyOrders = (await db.one(`SELECT COUNT(*)::int c FROM orders WHERE status = 'ready'`)).c;
    const totalSales = (await db.one(`SELECT COALESCE(SUM(amount),0) s FROM payments`)).s;
    const totalDueAmount = (await db.one(`
      SELECT COALESCE((SELECT SUM(total_amount) FROM orders),0) - COALESCE((SELECT SUM(amount) FROM payments),0) AS s
    `)).s;
    const byStatus = await db.query(`SELECT status, COUNT(*)::int c FROM orders GROUP BY status`);
    const lowStockFabrics = (await db.one(`SELECT COUNT(*)::int c FROM fabrics WHERE stock_qty <= min_stock_alert`)).c;
    const customersCount = (await db.one(`SELECT COUNT(*)::int c FROM customers`)).c;

    res.json({ totalOrders, activeOrders, readyOrders, totalSales, totalDueAmount, byStatus, lowStockFabrics, customersCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/sales', async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = `SELECT p.*, o.order_number, c.name AS customer_name
               FROM payments p
               JOIN orders o ON o.id = p.order_id
               JOIN customers c ON c.id = o.customer_id
               WHERE 1=1`;
    const params = [];
    if (from) { params.push(from); sql += ` AND p.payment_date::date >= $${params.length}::date`; }
    if (to) { params.push(to); sql += ` AND p.payment_date::date <= $${params.length}::date`; }
    sql += ` ORDER BY p.payment_date DESC`;
    const rows = await db.query(sql, params);
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    res.json({ rows, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/fabric-profit', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT f.id, f.name, f.color, f.cost_price, f.sell_price,
             COALESCE(SUM(o.fabric_qty_used), 0) AS total_used,
             COALESCE(SUM(o.fabric_qty_used), 0) * (f.sell_price - f.cost_price) AS estimated_profit
      FROM fabrics f
      LEFT JOIN orders o ON o.fabric_id = f.id
      GROUP BY f.id
      ORDER BY estimated_profit DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/worker-dues', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT w.id, w.name, w.role,
             COUNT(ot.id)::int AS total_tasks,
             SUM(CASE WHEN ot.completed THEN 1 ELSE 0 END)::int AS completed_tasks,
             COALESCE(SUM(CASE WHEN ot.completed THEN ot.wage_amount ELSE 0 END), 0) AS total_due,
             COALESCE(SUM(CASE WHEN NOT ot.completed THEN ot.wage_amount ELSE 0 END), 0) AS pending_amount
      FROM workers w
      LEFT JOIN order_tasks ot ON ot.worker_id = w.id
      GROUP BY w.id
      ORDER BY total_due DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/vat', async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = `SELECT order_number, order_date, total_amount, vat_amount FROM orders WHERE 1=1`;
    const params = [];
    if (from) { params.push(from); sql += ` AND order_date::date >= $${params.length}::date`; }
    if (to) { params.push(to); sql += ` AND order_date::date <= $${params.length}::date`; }
    const rows = await db.query(sql, params);
    const totalVat = rows.reduce((s, r) => s + Number(r.vat_amount || 0), 0);
    res.json({ rows, totalVat });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
