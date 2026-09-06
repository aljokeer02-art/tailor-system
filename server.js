// server.js — نقطة التشغيل المحلية فقط (يضيف تقديم الواجهة الثابتة + app.listen)
// على Vercel لا يُستخدم هذا الملف؛ الواجهة تُقدَّم تلقائياً من مجلد public، والـ API عبر api/index.js
const path = require('path');
const app = require('./app');

const publicPath = path.join(__dirname, 'public');
app.use(require('express').static(publicPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ نظام إدارة محل الخياطة يعمل على: http://localhost:${PORT}`);
});
