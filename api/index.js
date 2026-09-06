// api/index.js — نقطة دخول Vercel Serverless: كل طلبات /api/* تُوجَّه لهذه الدالة
// (راجع vercel.json — rewrites تحوّل /api/(.*) إلى هذا الملف)
module.exports = require('../app');
