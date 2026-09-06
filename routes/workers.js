const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try { res.json(await db.query(`SELECT * FROM workers ORDER BY id DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, role, phone, wage_per_piece } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'الاسم والدور مطلوبان' });
    const row = await db.one(
      `INSERT INTO workers (name, role, phone, wage_per_piece) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, role, phone || null, wage_per_piece || 0]
    );
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, role, phone, wage_per_piece, active } = req.body;
    await db.query(
      `UPDATE workers SET name=$1, role=$2, phone=$3, wage_per_piece=$4, active=$5 WHERE id=$6`,
      [name, role, phone, wage_per_piece, !!active, req.params.id]
    );
    res.json(await db.one(`SELECT * FROM workers WHERE id=$1`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/dues', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT ot.*, o.order_number FROM order_tasks ot
      JOIN orders o ON o.id = ot.order_id
      WHERE ot.worker_id = $1 ORDER BY ot.id DESC
    `, [req.params.id]);
    const totalDue = rows.filter(r => r.completed).reduce((s, r) => s + Number(r.wage_amount), 0);
    const totalPending = rows.filter(r => !r.completed).reduce((s, r) => s + Number(r.wage_amount), 0);
    res.json({ tasks: rows, total_due: totalDue, total_pending: totalPending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await db.query(`DELETE FROM workers WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
