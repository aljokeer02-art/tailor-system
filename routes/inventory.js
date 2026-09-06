const express = require('express');
const router = express.Router();
const db = require('../db');

// ---------- الأقمشة ----------
router.get('/fabrics', async (req, res) => {
  try { res.json(await db.query(`SELECT * FROM fabrics ORDER BY id DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/fabrics', async (req, res) => {
  try {
    const { name, color, unit, stock_qty, cost_price, sell_price, min_stock_alert } = req.body;
    if (!name) return res.status(400).json({ error: 'اسم القماش مطلوب' });
    const row = await db.one(`
      INSERT INTO fabrics (name, color, unit, stock_qty, cost_price, sell_price, min_stock_alert)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [name, color || null, unit || 'meter', stock_qty || 0, cost_price || 0, sell_price || 0, min_stock_alert ?? 5]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/fabrics/:id', async (req, res) => {
  try {
    const { name, color, unit, stock_qty, cost_price, sell_price, min_stock_alert } = req.body;
    await db.query(`
      UPDATE fabrics SET name=$1, color=$2, unit=$3, stock_qty=$4, cost_price=$5, sell_price=$6, min_stock_alert=$7
      WHERE id=$8
    `, [name, color, unit, stock_qty, cost_price, sell_price, min_stock_alert, req.params.id]);
    res.json(await db.one(`SELECT * FROM fabrics WHERE id=$1`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/fabrics/:id/restock', async (req, res) => {
  try {
    const { qty } = req.body;
    if (!qty || qty <= 0) return res.status(400).json({ error: 'الكمية غير صالحة' });
    await db.query(`UPDATE fabrics SET stock_qty = stock_qty + $1 WHERE id=$2`, [qty, req.params.id]);
    res.json(await db.one(`SELECT * FROM fabrics WHERE id=$1`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/fabrics/:id', async (req, res) => {
  try { await db.query(`DELETE FROM fabrics WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- المستلزمات ----------
router.get('/supplies', async (req, res) => {
  try { res.json(await db.query(`SELECT * FROM supplies ORDER BY id DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/supplies', async (req, res) => {
  try {
    const { name, type, unit, stock_qty, min_stock_alert } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'الاسم والنوع مطلوبان' });
    const row = await db.one(`
      INSERT INTO supplies (name, type, unit, stock_qty, min_stock_alert) VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [name, type, unit || 'piece', stock_qty || 0, min_stock_alert ?? 10]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/supplies/:id/restock', async (req, res) => {
  try {
    const { qty } = req.body;
    if (!qty || qty <= 0) return res.status(400).json({ error: 'الكمية غير صالحة' });
    await db.query(`UPDATE supplies SET stock_qty = stock_qty + $1 WHERE id=$2`, [qty, req.params.id]);
    res.json(await db.one(`SELECT * FROM supplies WHERE id=$1`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/supplies/:id', async (req, res) => {
  try { await db.query(`DELETE FROM supplies WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/alerts', async (req, res) => {
  try {
    const fabrics = await db.query(`SELECT * FROM fabrics WHERE stock_qty <= min_stock_alert`);
    const supplies = await db.query(`SELECT * FROM supplies WHERE stock_qty <= min_stock_alert`);
    res.json({ fabrics, supplies });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
