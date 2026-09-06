// app.js — تطبيق Express (بدون app.listen) — يُستخدم محلياً عبر server.js وعلى Vercel عبر api/index.js
require('dotenv').config(); // يقرأ ملف .env محلياً؛ لا يفعل شيئاً على Vercel/Render (المتغيرات محقونة مباشرة)
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const db = require('./db');
const { hashPassword, authMiddleware } = require('./utils/auth');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'alsaadamr94@gmail.com';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'Tailor@2026';

// يُنفَّذ مرة واحدة فقط (نتيجة مؤقتة محفوظة) لإنشاء الجداول وحساب المدير الافتراضي
let bootPromise = null;
function ensureReady() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await db.initSchema();
      const { c } = await db.one(`SELECT COUNT(*)::int c FROM users`);
      if (c === 0) {
        await db.query(
          `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'admin')`,
          ['المدير', ADMIN_EMAIL.toLowerCase().trim(), hashPassword(ADMIN_DEFAULT_PASSWORD)]
        );
        console.log('----------------------------------------------------------');
        console.log('تم إنشاء حساب المدير الافتراضي:');
        console.log(`  البريد الإلكتروني : ${ADMIN_EMAIL}`);
        console.log(`  كلمة المرور       : ${ADMIN_DEFAULT_PASSWORD}`);
        console.log('  الرجاء تسجيل الدخول ثم تغيير كلمة المرور فوراً من الإعدادات.');
        console.log('----------------------------------------------------------');
      }
    })();
  }
  return bootPromise;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// يضمن أن الجداول وحساب المدير جاهزان قبل أي طلب (آمن ورخيص بعد أول مرة)
app.use(async (req, res, next) => {
  try { await ensureReady(); next(); }
  catch (e) { res.status(500).json({ error: 'تعذّر الاتصال بقاعدة البيانات: ' + e.message }); }
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth')); // تسجيل الدخول عام؛ إدارة المستخدمين محمية داخلياً

app.use('/api', authMiddleware); // كل ما بعد هذا السطر يتطلب تسجيل دخول صالح

app.use('/api/customers', require('./routes/customers'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/workers', require('./routes/workers'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/invoices', require('./routes/invoices'));

module.exports = app;
