const express = require('express');
const router = express.Router();
const db = require('../db');

const STATUS_LABELS_AR = {
  new: 'جديد', cutting: 'قيد القص', sewing: 'قيد الخياطة', pressing: 'مرحلة الكوي',
  ready: 'جاهز للاستلام', delivered: 'تم التسليم', modification: 'تعديل',
};

async function nextOrderNumber() {
  const row = await db.one(`SELECT COUNT(*)::int AS c FROM orders`);
  const seq = row.c + 1;
  const year = new Date().getFullYear();
  return `WO-${year}-${String(seq).padStart(5, '0')}`;
}

async function estimateDeliveryDate() {
  const row = await db.one(`SELECT COUNT(*)::int AS c FROM orders WHERE status NOT IN ('delivered')`);
  const AVG_DAYS_PER_ORDER = 0.7;
  const BASE_DAYS = 3;
  const days = Math.ceil(BASE_DAYS + row.c * AVG_DAYS_PER_ORDER);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

router.get('/meta/status-labels', (req, res) => res.json(STATUS_LABELS_AR));

router.get('/', async (req, res) => {
  try {
    const { status, customer_id, search } = req.query;
    let sql = `
      SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
             f.name AS fabric_name,
             COALESCE((SELECT SUM(amount) FROM payments p WHERE p.order_id = o.id), 0) AS paid_amount
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN fabrics f ON f.id = o.fabric_id
      WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND o.status = $${params.length}`; }
    if (customer_id) { params.push(customer_id); sql += ` AND o.customer_id = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (o.order_number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
    }
    sql += ` ORDER BY o.id DESC`;
    res.json(await db.query(sql, params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const order = await db.one(`
      SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
             f.name AS fabric_name, f.color AS fabric_color
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN fabrics f ON f.id = o.fabric_id
      WHERE o.id = $1`, [req.params.id]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

    order.measurement = order.measurement_id
      ? await db.one(`SELECT * FROM measurements WHERE id=$1`, [order.measurement_id])
      : null;
    order.tasks = await db.query(`
      SELECT ot.*, w.name AS worker_name, w.role AS worker_role
      FROM order_tasks ot JOIN workers w ON w.id = ot.worker_id
      WHERE ot.order_id = $1 ORDER BY ot.id`, [req.params.id]);
    order.payments = await db.query(`SELECT * FROM payments WHERE order_id=$1 ORDER BY id`, [req.params.id]);
    order.status_history = await db.query(`SELECT * FROM order_status_history WHERE order_id=$1 ORDER BY id`, [req.params.id]);
    order.paid_amount = order.payments.reduce((s, p) => s + Number(p.amount), 0);
    order.remaining_amount = order.total_amount - order.paid_amount;
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const b = req.body;
  if (!b.customer_id || !b.total_amount) {
    return res.status(400).json({ error: 'العميل والمبلغ الإجمالي مطلوبان' });
  }
  try {
    const orderId = await db.tx(async (client) => {
      if (b.fabric_id && b.fabric_qty_used) {
        const { rows } = await client.query(`SELECT * FROM fabrics WHERE id=$1 FOR UPDATE`, [b.fabric_id]);
        const fabric = rows[0];
        if (!fabric) throw new Error('القماش غير موجود');
        if (fabric.stock_qty < b.fabric_qty_used) {
          throw new Error(`المخزون غير كافٍ من قماش "${fabric.name}" (المتوفر: ${fabric.stock_qty})`);
        }
        await client.query(`UPDATE fabrics SET stock_qty = stock_qty - $1 WHERE id=$2`, [b.fabric_qty_used, b.fabric_id]);
      }

      const orderNumber = await nextOrderNumber();
      const deliveryDate = b.expected_delivery_date || await estimateDeliveryDate();
      const vat = b.vat_amount ?? Math.round((b.total_amount - (b.discount_amount || 0)) * 0.15 * 100) / 100;

      const insertOrder = await client.query(`
        INSERT INTO orders
          (order_number, customer_id, measurement_id, fabric_id, fabric_qty_used, quantity,
           expected_delivery_date, status, total_amount, deposit_amount, discount_amount,
           vat_amount, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8,$9,$10,$11,$12)
        RETURNING id
      `, [
        orderNumber, b.customer_id, b.measurement_id || null, b.fabric_id || null,
        b.fabric_qty_used || 0, b.quantity || 1, deliveryDate,
        b.total_amount, b.deposit_amount || 0, b.discount_amount || 0, vat, b.notes || null
      ]);
      const orderId = insertOrder.rows[0].id;

      await client.query(`INSERT INTO order_status_history (order_id, status, note) VALUES ($1, 'new', 'تم إنشاء الطلب')`, [orderId]);

      if (b.deposit_amount) {
        await client.query(
          `INSERT INTO payments (order_id, amount, method, note) VALUES ($1, $2, 'cash', 'دفعة مقدمة عند إنشاء الطلب')`,
          [orderId, b.deposit_amount]
        );
      }

      if (Array.isArray(b.tasks)) {
        for (const t of b.tasks) {
          if (!t.worker_id) continue;
          await client.query(
            `INSERT INTO order_tasks (order_id, worker_id, task_type, wage_amount) VALUES ($1,$2,$3,$4)`,
            [orderId, t.worker_id, t.task_type, t.wage_amount || 0]
          );
        }
      }
      return orderId;
    });

    res.status(201).json(await db.one(`SELECT * FROM orders WHERE id=$1`, [orderId]));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!STATUS_LABELS_AR[status]) return res.status(400).json({ error: 'حالة غير صالحة' });
    const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [req.params.id]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

    await db.query(`UPDATE orders SET status=$1 WHERE id=$2`, [status, req.params.id]);
    await db.query(`INSERT INTO order_status_history (order_id, status, note) VALUES ($1,$2,$3)`,
      [req.params.id, status, note || `تغيير الحالة إلى: ${STATUS_LABELS_AR[status]}`]);

    res.json(await db.one(`SELECT * FROM orders WHERE id=$1`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/modification', async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'سبب التعديل مطلوب' });
    await db.query(`UPDATE orders SET status='modification', is_modification=TRUE, modification_reason=$1 WHERE id=$2`,
      [reason, req.params.id]);
    await db.query(`INSERT INTO order_status_history (order_id, status, note) VALUES ($1, 'modification', $2)`,
      [req.params.id, `تعديل: ${reason}`]);
    res.json(await db.one(`SELECT * FROM orders WHERE id=$1`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/tasks', async (req, res) => {
  try {
    const { worker_id, task_type, wage_amount } = req.body;
    if (!worker_id || !task_type) return res.status(400).json({ error: 'العامل ونوع المهمة مطلوبان' });
    const row = await db.one(
      `INSERT INTO order_tasks (order_id, worker_id, task_type, wage_amount) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, worker_id, task_type, wage_amount || 0]
    );
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/tasks/:taskId/complete', async (req, res) => {
  try {
    await db.query(`UPDATE order_tasks SET completed=TRUE, completed_at=NOW() WHERE id=$1`, [req.params.taskId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/payments', async (req, res) => {
  try {
    const { amount, method, note } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'قيمة الدفعة غير صالحة' });
    await db.query(`INSERT INTO payments (order_id, amount, method, note) VALUES ($1,$2,$3,$4)`,
      [req.params.id, amount, method || 'cash', note || null]);
    const paidRow = await db.one(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE order_id=$1`, [req.params.id]);
    const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [req.params.id]);
    res.status(201).json({ paid_amount: paidRow.s, remaining_amount: order.total_amount - paidRow.s });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
