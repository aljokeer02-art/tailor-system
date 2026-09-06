const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, signToken, authMiddleware, requireAdmin } = require('../utils/auth');

// POST /api/auth/login  (عام - بدون حماية)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
    const user = await db.one(`SELECT * FROM users WHERE email = $1`, [String(email).toLowerCase().trim()]);
    if (!user || !user.active) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    }
    const token = signToken(user);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', authMiddleware, (req, res) => res.json(req.user));

router.put('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' });
    }
    const user = await db.one(`SELECT * FROM users WHERE id=$1`, [req.user.id]);
    if (!verifyPassword(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }
    await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hashPassword(new_password), req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    res.json(await db.query(`SELECT id, name, email, role, active, created_at FROM users ORDER BY id`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'الاسم والبريد وكلمة المرور مطلوبة' });
    const row = await db.one(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role, active`,
      [name, String(email).toLowerCase().trim(), hashPassword(password), role === 'admin' ? 'admin' : 'staff']
    );
    res.status(201).json(row);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجّل مسبقاً' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { name, role, active, new_password } = req.body;
    await db.query(`UPDATE users SET name=$1, role=$2, active=$3 WHERE id=$4`,
      [name, role === 'admin' ? 'admin' : 'staff', !!active, req.params.id]);
    if (new_password) {
      await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hashPassword(new_password), req.params.id]);
    }
    res.json(await db.one(`SELECT id, name, email, role, active FROM users WHERE id=$1`, [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
    await db.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
