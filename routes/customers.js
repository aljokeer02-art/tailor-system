const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let rows;
    if (search) {
      rows = await db.query(
        `SELECT * FROM customers WHERE name ILIKE $1 OR phone ILIKE $1 ORDER BY id DESC`,
        [`%${search}%`]
      );
    } else {
      rows = await db.query(`SELECT * FROM customers ORDER BY id DESC`);
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const customer = await db.one(`SELECT * FROM customers WHERE id = $1`, [req.params.id]);
    if (!customer) return res.status(404).json({ error: 'العميل غير موجود' });
    const measurements = await db.query(`SELECT * FROM measurements WHERE customer_id = $1 ORDER BY id DESC`, [req.params.id]);
    const orders = await db.query(`SELECT * FROM orders WHERE customer_id = $1 ORDER BY id DESC`, [req.params.id]);
    res.json({ ...customer, measurements, orders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, phone, whatsapp, notify_sms, notify_wa, notes } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'الاسم والهاتف مطلوبان' });
    const customer = await db.one(
      `INSERT INTO customers (name, phone, whatsapp, notify_sms, notify_wa, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, phone, whatsapp || phone, !!notify_sms, !!notify_wa, notes || null]
    );
    res.status(201).json(customer);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'رقم الهاتف مسجّل مسبقاً لعميل آخر' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, phone, whatsapp, notify_sms, notify_wa, notes } = req.body;
    await db.query(
      `UPDATE customers SET name=$1, phone=$2, whatsapp=$3, notify_sms=$4, notify_wa=$5, notes=$6 WHERE id=$7`,
      [name, phone, whatsapp, !!notify_sms, !!notify_wa, notes || null, req.params.id]
    );
    res.json(await db.one(`SELECT * FROM customers WHERE id=$1`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query(`DELETE FROM customers WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- المقاسات ----------

router.post('/:id/measurements', async (req, res) => {
  try {
    const c = req.params.id;
    const m = req.body;
    const row = await db.one(`
      INSERT INTO measurements
        (customer_id, label, thobe_length, shoulder, chest, waist, sleeve_length,
         sleeve_width, neck, bottom_width, collar_type, pocket_type, buttons_type,
         embroidery, stitch_type, extra_notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [
      c, m.label || 'مقاس أساسي', m.thobe_length || null, m.shoulder || null, m.chest || null, m.waist || null,
      m.sleeve_length || null, m.sleeve_width || null, m.neck || null, m.bottom_width || null, m.collar_type || null,
      m.pocket_type || null, m.buttons_type || null, m.embroidery || null, m.stitch_type || null, m.extra_notes || null
    ]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/measurements', async (req, res) => {
  try {
    res.json(await db.query(`SELECT * FROM measurements WHERE customer_id=$1 ORDER BY id DESC`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
