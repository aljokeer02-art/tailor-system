const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateInvoice } = require('../utils/zatca');

router.get('/', async (req, res) => {
  try {
    res.json(await db.query(`
      SELECT i.*, o.order_number, c.name AS customer_name
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      ORDER BY i.id DESC
    `));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const invoice = await db.one(`SELECT * FROM invoices WHERE id=$1`, [req.params.id]);
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    res.json(invoice);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/generate', async (req, res) => {
  try {
    const { order_id } = req.body;
    const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [order_id]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

    const existing = await db.one(`SELECT * FROM invoices WHERE order_id=$1`, [order_id]);
    if (existing) return res.status(409).json({ error: 'تم إصدار فاتورة لهذا الطلب مسبقاً', invoice: existing });

    const settings = await db.one(`SELECT * FROM shop_settings WHERE id=1`);

    const invoiceNumber = await db.tx(async (client) => {
      const gen = generateInvoice({ shopSettings: settings, order });

      await client.query(`
        INSERT INTO invoices
          (order_id, invoice_number, icv, uuid, previous_hash, invoice_hash, qr_base64,
           seller_name, vat_number, total_amount, vat_amount)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        order_id, gen.invoiceNumber, gen.icv, gen.uuid, gen.previousHash, gen.invoiceHash,
        gen.qrBase64, settings.shop_name, settings.vat_number, order.total_amount, order.vat_amount
      ]);

      await client.query(`UPDATE shop_settings SET last_icv=$1, last_hash=$2 WHERE id=1`, [gen.icv, gen.invoiceHash]);

      return gen.invoiceNumber;
    });

    res.status(201).json(await db.one(`SELECT * FROM invoices WHERE invoice_number=$1`, [invoiceNumber]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/settings/shop', async (req, res) => {
  try { res.json(await db.one(`SELECT * FROM shop_settings WHERE id=1`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/settings/shop', async (req, res) => {
  try {
    const { shop_name, vat_number, vat_rate, phone, address } = req.body;
    await db.query(`
      UPDATE shop_settings SET shop_name=$1, vat_number=$2, vat_rate=$3, phone=$4, address=$5 WHERE id=1
    `, [shop_name, vat_number, vat_rate, phone, address]);
    res.json(await db.one(`SELECT * FROM shop_settings WHERE id=1`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
