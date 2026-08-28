const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'orders.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sellers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    payu_ext_customer_id TEXT,
    payu_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL REFERENCES sellers(id),
    name TEXT NOT NULL,
    description TEXT,
    price_bani INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ron',
    image_path TEXT,
    stock_total INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Fiecare bucata cumparata primeste un numar unic (aleatoriu), in limita
  -- stocului produsului (1..stock_total). Aceste numere sunt continutul
  -- fisierului digital generat automat la livrare si se folosesc ulterior
  -- si pentru o eventuala extragere organizata separat de platforma.
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    order_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(product_id, number)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    buyer_name TEXT,
    buyer_phone TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    payu_order_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | locked | unlocked
    amount_bani INTEGER,
    platform_fee_bani INTEGER,
    attempts_left INTEGER NOT NULL DEFAULT 3,
    current_question TEXT, -- JSON: { text, options, correctIndex }
    unlocked INTEGER NOT NULL DEFAULT 0,
    download_token TEXT,
    downloads_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_product ON tickets(product_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
  CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id); CREATE TABLE IF NOT EXISTS subscribers ( id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')) );
`);

// Migratie usoara: adauga coloana buyer_email pentru baze de date create
// inainte de a exista trimiterea de email-uri de confirmare catre clienti.
const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
if (!orderColumns.includes('buyer_email')) {
  db.exec('ALTER TABLE orders ADD COLUMN buyer_email TEXT');
}

module.exports = db;
