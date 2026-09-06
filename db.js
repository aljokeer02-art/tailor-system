// db.js — اتصال قاعدة البيانات (PostgreSQL عبر Supabase) وتعريف المخطط الكامل
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  لم يتم ضبط DATABASE_URL — أضف رابط اتصال Supabase Postgres في متغيرات البيئة.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : (process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }),
});

// تنفيذ استعلام وإرجاع كل الصفوف
async function query(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

// تنفيذ استعلام وإرجاع أول صف فقط (أو null)
async function one(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

// تنفيذ عدة عمليات ضمن معاملة واحدة (Transaction) — fn تستقبل عميل اتصال (client)
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const SCHEMA_SQL = `
-- ==========================================================
-- 1. العملاء (Customers)
-- ==========================================================
CREATE TABLE IF NOT EXISTS customers (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  whatsapp      TEXT,
  notify_sms    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_wa     BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 2. مقاسات العملاء (نسخ متعددة لكل عميل)
-- ==========================================================
CREATE TABLE IF NOT EXISTS measurements (
  id                SERIAL PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label             TEXT NOT NULL DEFAULT 'مقاس أساسي',
  thobe_length      REAL,
  shoulder          REAL,
  chest             REAL,
  waist             REAL,
  sleeve_length     REAL,
  sleeve_width      REAL,
  neck              REAL,
  bottom_width      REAL,
  collar_type       TEXT,
  pocket_type       TEXT,
  buttons_type      TEXT,
  embroidery        TEXT,
  stitch_type       TEXT,
  extra_notes       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 3. الأقمشة (Fabrics)
-- ==========================================================
CREATE TABLE IF NOT EXISTS fabrics (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  color           TEXT,
  unit            TEXT NOT NULL DEFAULT 'meter',
  stock_qty       REAL NOT NULL DEFAULT 0,
  cost_price      REAL NOT NULL DEFAULT 0,
  sell_price      REAL NOT NULL DEFAULT 0,
  min_stock_alert REAL NOT NULL DEFAULT 5,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 4. مستلزمات الخياطة
-- ==========================================================
CREATE TABLE IF NOT EXISTS supplies (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  unit            TEXT NOT NULL DEFAULT 'piece',
  stock_qty       REAL NOT NULL DEFAULT 0,
  min_stock_alert REAL NOT NULL DEFAULT 10,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 5. العمال
-- ==========================================================
CREATE TABLE IF NOT EXISTS workers (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL,
  phone          TEXT,
  wage_per_piece REAL NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 6. الطلبات / أوراق العمل
-- ==========================================================
CREATE TABLE IF NOT EXISTS orders (
  id                     SERIAL PRIMARY KEY,
  order_number           TEXT NOT NULL UNIQUE,
  customer_id            INTEGER NOT NULL REFERENCES customers(id),
  measurement_id         INTEGER REFERENCES measurements(id),
  fabric_id              INTEGER REFERENCES fabrics(id),
  fabric_qty_used        REAL DEFAULT 0,
  quantity               INTEGER NOT NULL DEFAULT 1,
  order_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_delivery_date DATE,
  status                 TEXT NOT NULL DEFAULT 'new',
  total_amount           REAL NOT NULL DEFAULT 0,
  deposit_amount         REAL NOT NULL DEFAULT 0,
  discount_amount        REAL NOT NULL DEFAULT 0,
  vat_amount             REAL NOT NULL DEFAULT 0,
  notes                  TEXT,
  is_modification        BOOLEAN NOT NULL DEFAULT FALSE,
  modification_reason    TEXT,
  original_order_id      INTEGER REFERENCES orders(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  note       TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_tasks (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  worker_id     INTEGER NOT NULL REFERENCES workers(id),
  task_type     TEXT NOT NULL,
  wage_amount   REAL NOT NULL DEFAULT 0,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 7. الدفعات
-- ==========================================================
CREATE TABLE IF NOT EXISTS payments (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount        REAL NOT NULL,
  method        TEXT NOT NULL DEFAULT 'cash',
  payment_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note          TEXT
);

-- ==========================================================
-- 8. الفواتير الإلكترونية (ZATCA)
-- ==========================================================
CREATE TABLE IF NOT EXISTS invoices (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id),
  invoice_number    TEXT NOT NULL UNIQUE,
  icv               INTEGER NOT NULL,
  uuid              TEXT NOT NULL,
  previous_hash     TEXT NOT NULL,
  invoice_hash      TEXT NOT NULL,
  qr_base64         TEXT NOT NULL,
  seller_name       TEXT NOT NULL,
  vat_number        TEXT NOT NULL,
  total_amount      REAL NOT NULL,
  vat_amount        REAL NOT NULL,
  zatca_status      TEXT NOT NULL DEFAULT 'pending',
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 9. المستخدمون
-- ==========================================================
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_measurements_customer ON measurements(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_tasks_order ON order_tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_tasks_worker ON order_tasks(worker_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS shop_settings (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  shop_name    TEXT NOT NULL DEFAULT 'مؤسسة الخياطة الرجالية',
  vat_number   TEXT NOT NULL DEFAULT '300000000000003',
  vat_rate     REAL NOT NULL DEFAULT 0.15,
  phone        TEXT,
  address      TEXT,
  last_icv     INTEGER NOT NULL DEFAULT 0,
  last_hash    TEXT NOT NULL DEFAULT '0'
);
INSERT INTO shop_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
`;

let initPromise = null;
// ينشئ الجداول عند أول استخدام فقط (آمن للتكرار — CREATE TABLE IF NOT EXISTS)
function initSchema() {
  if (!initPromise) initPromise = pool.query(SCHEMA_SQL);
  return initPromise;
}

module.exports = { pool, query, one, tx, initSchema };
