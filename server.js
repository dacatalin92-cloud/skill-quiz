require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const {
  setSellerCookie, clearSellerCookie, getSellerIdFromReq,
  setAdminCookie, clearAdminCookie, isAdminReq,
} = require('./lib/session');
const { makeImageUploader, IMAGES_DIR } = require('./lib/uploads');
const { makePayU } = require('./lib/payu');
const { makeStripe } = require('./lib/stripe');
const { makeMailer, escapeHtml } = require('./lib/mailer');
const { generateQuestion } = require('./lib/questionGenerator');
const { renderTicketSvg } = require('./lib/ticketImage');
const { streamTicketsPdf } = require('./lib/ticketPdf'); const { makeWhatsapp, normalizePhone } = require('./lib/whatsapp'); const { makePush } = require('./lib/push');
const { makeOblio } = require('./lib/oblio');

const app = express();

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '3', 10);
const MAX_DOWNLOADS = parseInt(process.env.MAX_DOWNLOADS || '10', 10);
const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '15');
const MAX_QUANTITY_PER_ORDER = parseInt(process.env.MAX_QUANTITY_PER_ORDER || '20', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const PAYU_POS_ID = process.env.PAYU_POS_ID || '';
const PAYU_CLIENT_ID = process.env.PAYU_CLIENT_ID || '';
const PAYU_CLIENT_SECRET = process.env.PAYU_CLIENT_SECRET || '';
const PAYU_SECOND_KEY = process.env.PAYU_SECOND_KEY || '';
const PAYU_SANDBOX = String(process.env.PAYU_SANDBOX || 'true') === 'true';
const PAYU_MARKETPLACE_PARTNER_ID = process.env.PAYU_MARKETPLACE_PARTNER_ID || '';

// Ascunde PayU de pe site (la cererea lui Andrei) - clientii vor vedea/putea
// folosi doar plata cu cardul prin Stripe. Codul PayU ramane configurat si
// functional pe server, doar nu mai este oferit clientilor. Pentru a-l
// reafisa mai tarziu, seteaza variabila HIDE_PAYU=false pe Railway (fara sa
// mai fie nevoie de o noua modificare de cod).
const HIDE_PAYU = String(process.env.HIDE_PAYU || 'true').toLowerCase() !== 'false';

const payuConfigured = !!(PAYU_POS_ID && PAYU_CLIENT_ID && PAYU_CLIENT_SECRET && PAYU_SECOND_KEY);
const payu = payuConfigured
  ? makePayU({
      posId: PAYU_POS_ID,
      clientId: PAYU_CLIENT_ID,
      clientSecret: PAYU_CLIENT_SECRET,
      secondKey: PAYU_SECOND_KEY,
      sandbox: PAYU_SANDBOX,
      marketplacePartnerId: PAYU_MARKETPLACE_PARTNER_ID,
    })
  : null;

// Stripe - a doua metoda de plata, pe langa PayU. Clientul alege la
// checkout intre PayU si plata cu cardul prin Stripe.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripeConfigured = !!STRIPE_SECRET_KEY;
const stripeClient = stripeConfigured
  ? makeStripe({ secretKey: STRIPE_SECRET_KEY, webhookSecret: STRIPE_WEBHOOK_SECRET })
  : null;

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const mailer = makeMailer({ apiKey: RESEND_API_KEY, from: RESEND_FROM }); const META_WHATSAPP_TOKEN = process.env.META_WHATSAPP_TOKEN || ''; const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || ''; const META_WHATSAPP_TEMPLATE = process.env.META_WHATSAPP_TEMPLATE || 'produs_nou_disponibil'; const META_WHATSAPP_REMINDER_TEMPLATE = process.env.META_WHATSAPP_REMINDER_TEMPLATE || 'reminder_stoc_disponibil'; const META_WHATSAPP_LANG = process.env.META_WHATSAPP_LANG || 'ro'; const whatsappConfigured = !!(META_WHATSAPP_TOKEN && META_PHONE_NUMBER_ID); const whatsapp = whatsappConfigured ? makeWhatsapp({ accessToken: META_WHATSAPP_TOKEN, phoneNumberId: META_PHONE_NUMBER_ID, templateName: META_WHATSAPP_TEMPLATE, languageCode: META_WHATSAPP_LANG }) : null; const WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ''; const PUSH_VAPID_PUBLIC_KEY = process.env.PUSH_VAPID_PUBLIC_KEY || ''; const PUSH_VAPID_PRIVATE_KEY = process.env.PUSH_VAPID_PRIVATE_KEY || ''; const PUSH_VAPID_SUBJECT = process.env.PUSH_VAPID_SUBJECT || 'mailto:aromaprodcom@gmail.com'; const pushConfigured = !!(PUSH_VAPID_PUBLIC_KEY && PUSH_VAPID_PRIVATE_KEY); const push = pushConfigured ? makePush({ publicKey: PUSH_VAPID_PUBLIC_KEY, privateKey: PUSH_VAPID_PRIVATE_KEY, subject: PUSH_VAPID_SUBJECT }) : null;

const OBLIO_EMAIL = process.env.OBLIO_EMAIL || '';
const OBLIO_SECRET = process.env.OBLIO_SECRET || '';
const OBLIO_CIF = process.env.OBLIO_CIF || '';
const OBLIO_SERIES = process.env.OBLIO_SERIES || '';
const oblioConfigured = !!(OBLIO_EMAIL && OBLIO_SECRET && OBLIO_CIF && OBLIO_SERIES);
const oblio = oblioConfigured
  ? makeOblio({ email: OBLIO_EMAIL, secret: OBLIO_SECRET, cif: OBLIO_CIF, seriesName: OBLIO_SERIES })
  : null;

async function createInvoiceForOrder(order) {
  if (!oblio) return;
  try {
    const product = getProduct(order.product_id);
    if (!product) return;
    const invoice = await oblio.createInvoice({
      buyerName: order.buyer_name,
      buyerEmail: order.buyer_email,
      buyerPhone: order.buyer_phone,
      buyerAddress: order.buyer_address,
      productName: product.name,
      priceRon: product.price_bani / 100,
      quantity: order.quantity,
      orderId: order.id,
    });
    db.prepare('UPDATE orders SET invoice_series = ?, invoice_number = ?, invoice_link = ? WHERE id = ?')
      .run(invoice.seriesName || null, invoice.number || null, invoice.link || null, order.id);
  } catch (err) {
    console.error('Nu am putut emite factura Oblio pentru comanda ' + order.id + ':', err.message);
  }
}

const upload = makeImageUploader();

// Trimite o notificare push (ca de aplicatie, pe telefon) catre adminul care
// a instalat panoul de mesaje WhatsApp si a activat notificarile, de fiecare
// data cand soseste un mesaj nou de la un client.
async function notifyAdminNewWhatsappMessage(fromPhone, body) {
  if (!push) return;
  const subs = db.prepare('SELECT * FROM admin_push_subscriptions').all();
  if (!subs.length) return;
  const payload = {
    title: 'Mesaj WhatsApp nou',
    body: '+' + fromPhone + ': ' + String(body || '').slice(0, 120),
    url: BASE_URL + '/admin/whatsapp.html',
  };
  for (const sub of subs) {
    try {
      await push.sendToSubscription(sub, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM admin_push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        console.error('Nu am putut trimite push admin catre ' + sub.id + ':', err.message);
      }
    }
  }
}

function getNotificationPhones() { const subs = db.prepare('SELECT phone FROM subscribers').all().map((r) => r.phone); const buyers = db.prepare("SELECT DISTINCT buyer_phone as phone FROM orders WHERE buyer_phone IS NOT NULL AND status IN ('paid','locked','unlocked')").all().map((r) => r.phone); return [...new Set([...subs, ...buyers].filter(Boolean))]; } async function notifyNewProduct(product) { if (!whatsapp) return; const phones = getNotificationPhones(); const priceText = (product.price_bani / 100).toFixed(2) + ' RON'; const link = BASE_URL + '/'; for (const phone of phones) { try { await whatsapp.sendTemplate(phone, [product.name, priceText, link]); } catch (err) { console.error('Nu am putut trimite WhatsApp catre ' + phone + ':', err.message); } } } async function notifyPushSubscribers(product) { if (!push) return; const subs = db.prepare('SELECT * FROM push_subscriptions').all(); const priceText = (product.price_bani / 100).toFixed(2) + ' RON'; const payload = { title: 'Produs nou: ' + product.name, body: priceText + ' - stoc limitat!', url: BASE_URL + '/' }; for (const sub of subs) { try { await push.sendToSubscription(sub, payload); } catch (err) { if (err.statusCode === 404 || err.statusCode === 410) { db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id); } else { console.error('Nu am putut trimite push catre ' + sub.id + ':', err.message); } } } }

// Reminder WhatsApp la 24h de la achizitie: catre fiecare cumparator cu un
// numar de telefon valid, care a platit o comanda acum cel putin 24h si nu a
// primit inca acest mesaj, trimitem un sablon cu poza produsului cumparat si
// cate numere mai sunt disponibile din el - ca sa il incurajam sa mai prinda
// cateva inainte sa se epuizeze stocul. Se aplica si comenzilor mai vechi
// (deja existente inainte de aceasta functie) - la prima rulare vor primi
// toate cate un singur reminder, iar de acolo inainte doar cele noi, la 24h.
async function checkAndSendPurchaseReminders() {
  if (!whatsapp) return;
  const rows = db
    .prepare(
      `SELECT o.*, p.name as product_name, p.image_path, p.stock_total, p.id as product_id
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.status IN ('paid','locked','unlocked')
         AND o.reminder_24h_sent = 0
         AND o.buyer_phone IS NOT NULL
         AND o.created_at <= datetime('now', '-24 hours')`
    )
    .all();
  for (const o of rows) {
    try {
      const assigned = ticketsAssignedCount(o.product_id);
      const remaining = Math.max(0, o.stock_total - assigned);
      if (remaining <= 0) {
        // Stoc epuizat - nu mai are sens un reminder de "mai prinde cateva
        // numere", asa ca marcam comanda ca gestionata, fara sa trimitem.
        db.prepare('UPDATE orders SET reminder_24h_sent = 1 WHERE id = ?').run(o.id);
        continue;
      }
      const firstName = (o.buyer_name || '').trim().split(/\s+/)[0] || 'prieten';
      const imageUrl = o.image_path
        ? `${BASE_URL}/uploads/images/${path.basename(o.image_path)}`
        : `${BASE_URL}/img/placeholder.svg`;
      await whatsapp.sendTemplate(
        o.buyer_phone,
        [firstName, o.product_name, String(remaining)],
        { headerImageUrl: imageUrl, templateName: META_WHATSAPP_REMINDER_TEMPLATE }
      );
      db.prepare('UPDATE orders SET reminder_24h_sent = 1 WHERE id = ?').run(o.id);
    } catch (err) {
      console.error('Nu am putut trimite reminder WhatsApp pentru comanda ' + o.id + ':', err.message);
      // Nu marcam reminder_24h_sent - reincercam la urmatoarea verificare.
    }
  }
}

// ---------------------------------------------------------------------------
// Notificare PayU - body RAW (necesar pentru verificarea semnaturii), definit
// inainte de express.json(). PayU trimite un POST la notifyUrl de fiecare
// data cand starea unei comenzi se schimba (nu doar la plata reusita).
// ---------------------------------------------------------------------------
app.post('/payu/notificare', express.raw({ type: '*/*' }), (req, res) => {
  if (!payu) return res.status(500).send('PayU nu este configurat.');
  try {
    const rawBody = req.body.toString('utf8');
    const signatureHeader = req.headers['openpayu-signature'];
    if (!payu.verifyNotifySignature(rawBody, signatureHeader)) {
      console.error('Semnatura notificarii PayU nu a putut fi verificata.');
      return res.status(400).send('Semnatura invalida.');
    }
    const data = JSON.parse(rawBody);
    const order = data.order;
    const orderId = order && order.extOrderId;
    const status = order && order.status;
    if (orderId && status === 'COMPLETED') {
      markOrderPaid(orderId, order.orderId);
    } else if (orderId && order && order.orderId) {
      // Salveaza oricum id-ul comenzii PayU, chiar daca inca nu e platita,
      // ca sa poata fi folosit ulterior la interogarea starii.
      db.prepare(`UPDATE orders SET payu_order_id = COALESCE(payu_order_id, ?) WHERE id = ? AND status = 'pending'`).run(
        order.orderId,
        orderId
      );
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('Eroare la procesarea notificarii PayU:', err.message);
    res.status(400).send('Eroare la procesare.');
  }
});

// ---------------------------------------------------------------------------
// Webhook Stripe - body RAW (necesar pentru verificarea semnaturii), definit
// tot inainte de express.json(), la fel ca la PayU. Stripe trimite un POST
// aici cand se finalizeaza plata unei Checkout Session.
// ---------------------------------------------------------------------------
app.post('/stripe/webhook', express.raw({ type: '*/*' }), (req, res) => {
  if (!stripeClient) return res.status(500).send('Stripe nu este configurat.');
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET nu este setat - nu pot verifica webhook-ul Stripe.');
    return res.status(500).send('Webhook Stripe neconfigurat.');
  }
  let event;
  try {
    event = stripeClient.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('Semnatura webhook-ului Stripe nu a putut fi verificata:', err.message);
    return res.status(400).send('Semnatura invalida.');
  }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const orderId = session.client_reference_id || (session.metadata && session.metadata.orderId);
      if (orderId && session.payment_status === 'paid') {
        markOrderPaidStripe(orderId, session.id);
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('Eroare la procesarea webhook-ului Stripe:', err.message);
    res.status(400).send('Eroare la procesare.');
  }
});

app.use(express.json()); app.post('/api/abonare', (req, res) => { const digits = req.body && req.body.phone ? String(req.body.phone).replace(/\D/g, '') : ''; if (!digits || digits.length < 9) { return res.status(400).json({ error: 'Un numar de telefon valid este obligatoriu.' }); } try { db.prepare('INSERT OR IGNORE INTO subscribers (id, phone) VALUES (?, ?)').run(uuidv4(), String(req.body.phone).trim()); res.json({ ok: true }); } catch (err) { console.error(err); res.status(500).json({ error: 'Eroare la abonare.' }); } }); app.get('/api/push/public-key', (req, res) => { res.json({ publicKey: pushConfigured ? PUSH_VAPID_PUBLIC_KEY : null }); }); app.get('/api/payment-methods', (req, res) => { res.json({ payu: !!payu && !HIDE_PAYU, stripe: !!stripeClient }); }); app.post('/api/push/subscribe', (req, res) => { const sub = req.body; if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) { return res.status(400).json({ error: 'Abonament push invalid.' }); } try { db.prepare('INSERT INTO push_subscriptions (id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth').run(uuidv4(), sub.endpoint, sub.keys.p256dh, sub.keys.auth); res.json({ ok: true }); } catch (err) { console.error(err); res.status(500).json({ error: 'Eroare la abonare push.' }); } });
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/images', express.static(IMAGES_DIR));

// ---------------------------------------------------------------------------
// Ajutoare DB
// ---------------------------------------------------------------------------
function getSeller(id) {
  return db.prepare('SELECT * FROM sellers WHERE id = ?').get(id);
}
function getSellerByEmail(email) {
  return db.prepare('SELECT * FROM sellers WHERE email = ?').get(String(email).toLowerCase().trim());
}
function getProduct(id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
}
function ticketsAssignedCount(productId) {
  return db.prepare('SELECT COUNT(*) as c FROM tickets WHERE product_id = ?').get(productId).c;
}
function publicSeller(seller) {
  return { id: seller.id, name: seller.name, payuVerified: !!seller.payu_verified };
}
function publicProduct(product, seller) {
  const assigned = ticketsAssignedCount(product.id);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceBani: product.price_bani,
    currency: product.currency,
    image: product.image_path ? `/uploads/images/${path.basename(product.image_path)}` : null,
    stockTotal: product.stock_total,
    stockRemaining: Math.max(0, product.stock_total - assigned),
    seller: seller ? publicSeller(seller) : undefined,
  };
}

function requireSeller(req, res, next) {
  const sellerId = getSellerIdFromReq(req);
  if (!sellerId) return res.status(401).json({ error: 'Trebuie sa fii autentificat.' });
  const seller = getSeller(sellerId);
  if (!seller) return res.status(401).json({ error: 'Cont inexistent.' });
  req.seller = seller;
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Admin neconfigurat (lipseste ADMIN_PASSWORD din .env).' });
  if (!isAdminReq(req)) return res.status(401).json({ error: 'Neautentificat.' });
  next();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Aloca numere aleatorii (nu secventiale), neutilizate inca, din intervalul
// 1..stock_total al produsului.
function assignTickets(order) {
  const already = db.prepare('SELECT COUNT(*) as c FROM tickets WHERE order_id = ?').get(order.id).c;
  if (already > 0) return; // deja alocate
  const product = getProduct(order.product_id);
  if (!product) return;

  const used = new Set(
    db.prepare('SELECT number FROM tickets WHERE product_id = ?').all(product.id).map((r) => r.number)
  );
  const available = [];
  for (let n = 1; n <= product.stock_total; n++) {
    if (!used.has(n)) available.push(n);
  }
  const picked = shuffle(available).slice(0, order.quantity);

  const insert = db.prepare('INSERT INTO tickets (id, product_id, order_id, number) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const number of picked) insert.run(uuidv4(), product.id, order.id, number);
  });
  tx();

  if (picked.length < order.quantity) {
    console.warn(`Stoc insuficient la alocare pentru comanda ${order.id}: cerute ${order.quantity}, alocate ${picked.length}.`);
  }
}

function finalizePaidOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assignTickets(order);
  sendOrderConfirmationEmail(order);
  createInvoiceForOrder(order).catch((err) => console.error('Eroare la emiterea facturii:', err.message));
}

function markOrderPaid(orderId, payuOrderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'pending') return;
  if (payuOrderId) {
    db.prepare(`UPDATE orders SET status = 'paid', payu_order_id = ? WHERE id = ?`).run(payuOrderId, orderId);
  } else {
    db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(orderId);
  }
  finalizePaidOrder(orderId);
}

// Echivalentul lui markOrderPaid, pentru comenzile platite prin Stripe
// (retine si id-ul sesiunii Stripe Checkout, util pentru interogari
// ulterioare sau rambursari facute manual din dashboard-ul Stripe).
function markOrderPaidStripe(orderId, stripeSessionId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'pending') return;
  db.prepare(`UPDATE orders SET status = 'paid', stripe_session_id = ? WHERE id = ?`).run(stripeSessionId, orderId);
  finalizePaidOrder(orderId);
}

// Trimite (best-effort, nu blocheaza fluxul de plata daca esueaza) un email
// de confirmare catre client, cu link-ul de continuare - util mai ales daca
// inchide pagina inainte sa raspunda la intrebare.
function sendOrderConfirmationEmail(order) {
  if (!mailer || !order.buyer_email) return;
  const product = getProduct(order.product_id);
  const link = `${BASE_URL}/raspunde.html?order=${order.id}`;
  const productName = product ? product.name : 'produsul comandat';
  mailer
    .sendEmail({
      to: order.buyer_email,
      subject: `Plata confirmata - ${productName}`,
      html: `
        <p>Salut${order.buyer_name ? ' ' + escapeHtml(order.buyer_name) : ''},</p>
        <p>Plata ta pentru <strong>${escapeHtml(productName)}</strong> a fost confirmata.</p>
        <p>Ca sa primesti produsul digital, raspunde corect la intrebarea de verificare aici:</p>
        <p><a href="${link}">${link}</a></p>
        <p>Pastreaza acest email - link-ul de mai sus te duce oricand inapoi la comanda ta, chiar daca inchizi pagina.</p>
      `,
    })
    .catch((err) => console.error('Nu am putut trimite emailul de confirmare catre client:', err.message));
}

function orderTicketNumbers(orderId) {
  return db.prepare('SELECT number FROM tickets WHERE order_id = ? ORDER BY number').all(orderId).map((r) => r.number);
}

// =============================================================================
// API PUBLIC - vitrina, checkout, raspuns la intrebare, lista participanti
// =============================================================================

app.get('/api/products', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, s.name as seller_name, s.payu_verified
       FROM products p JOIN sellers s ON s.id = p.seller_id
       WHERE p.active = 1
       ORDER BY p.created_at DESC`
    )
    .all();
  res.json(
    rows.map((r) =>
      publicProduct(r, { id: r.seller_id, name: r.seller_name, payu_verified: r.payu_verified })
    )
  );
});

app.get('/api/produs/:id/participanti', (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produs inexistent.' });
  const rows = db
    .prepare(
      `SELECT t.number, o.buyer_name
       FROM tickets t JOIN orders o ON o.id = t.order_id
       WHERE t.product_id = ?
       ORDER BY t.number`
    )
    .all(product.id);
  res.json({
    productName: product.name,
    participants: rows.map((r) => ({
      number: r.number,
      firstName: (r.buyer_name || '').trim().split(/\s+/)[0] || 'Anonim',
    })),
  });
});

// Toate numerele posibile ale unui produs (1..stock_total), varianta publica:
// arata pentru fiecare numar daca a fost achizitionat, cu prenumele
// cumparatorului (fara alte date de contact) pentru cele achizitionate - la
// fel ca la lista de participanti, dar sub forma de grid complet, ca sa vada
// clientii si ce numere mai sunt libere.
app.get('/api/produs/:id/numere', (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produs inexistent.' });
  const tickets = db
    .prepare(
      `SELECT t.number, o.buyer_name
       FROM tickets t JOIN orders o ON o.id = t.order_id
       WHERE t.product_id = ?`
    )
    .all(product.id);
  const byNumber = new Map(tickets.map((t) => [t.number, t]));
  const numbers = [];
  for (let n = 1; n <= product.stock_total; n++) {
    const t = byNumber.get(n);
    numbers.push({
      number: n,
      purchased: !!t,
      firstName: t ? (t.buyer_name || '').trim().split(/\s+/)[0] || 'Anonim' : null,
    });
  }
  res.json({
    productName: product.name,
    stockTotal: product.stock_total,
    numbers,
  });
});

app.post('/api/checkout', async (req, res) => {
  try {
    const { productId, name, phone, email, address } = req.body;
    // Metoda de plata aleasa de client: 'payu' (implicit) sau 'stripe'.
    let paymentMethod = req.body.paymentMethod === 'stripe' ? 'stripe' : 'payu';
    // PayU este ascuns temporar (HIDE_PAYU) - orice cerere care ar folosi PayU
    // trece automat pe Stripe, daca e disponibil.
    if (paymentMethod === 'payu' && HIDE_PAYU && stripeClient) {
      paymentMethod = 'stripe';
    }
    if (paymentMethod === 'stripe' && !stripeClient) {
      return res.status(500).json({ error: 'Plata cu cardul (Stripe) nu este configurata pe server.' });
    }
    if (paymentMethod === 'payu' && (!payu || HIDE_PAYU)) {
      return res.status(500).json({ error: 'PayU nu este disponibil momentan.' });
    }
    const quantity = Math.max(1, Math.min(MAX_QUANTITY_PER_ORDER, parseInt(req.body.quantity, 10) || 1));

    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Numele este obligatoriu.' });
    if (!phone || !String(phone).trim() || String(phone).replace(/\D/g, '').length < 9) {
      return res.status(400).json({ error: 'Un numar de telefon valid este obligatoriu.' });
    }
    // Email-ul e optional - daca lipseste, clientul primeste produsul doar pe
    // pagina, fara email de confirmare/recuperare.
    const trimmedEmail = email && String(email).trim() ? String(email).trim() : null;
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Adresa de email nu este valida.' });
    }
    // Adresa e optionala - clientul o completeaza doar daca vrea factura cu
    // datele complete; fara ea, factura Oblio se emite in continuare, doar
    // fara linia de adresa.
    const trimmedAddress = address && String(address).trim() ? String(address).trim() : null;

    const product = getProduct(productId);
    if (!product || !product.active) return res.status(404).json({ error: 'Produs inexistent.' });
    const seller = getSeller(product.seller_id);
    if (!seller) {
      return res.status(400).json({ error: 'Vanzator inexistent.' });
    }

    const assigned = ticketsAssignedCount(product.id);
    const remaining = Math.max(0, product.stock_total - assigned);
    if (remaining <= 0) return res.status(400).json({ error: 'Stocul acestui produs s-a epuizat.' });
    if (quantity > remaining) {
      return res.status(400).json({ error: `Mai sunt doar ${remaining} bucati disponibile din acest produs.` });
    }

    const orderId = uuidv4();
    const totalBani = product.price_bani * quantity;
    const feeBani = 0; // Fara marketplace/split - toti banii merg direct in contul PayU al platformei.

    db.prepare(
      `INSERT INTO orders (id, product_id, seller_id, buyer_name, buyer_phone, buyer_email, buyer_address, quantity, attempts_left, amount_bani, platform_fee_bani, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(orderId, product.id, seller.id, String(name).trim(), String(phone).trim(), trimmedEmail, trimmedAddress, quantity, MAX_ATTEMPTS, totalBani, feeBani, paymentMethod);

    if (paymentMethod === 'stripe') {
      const { redirectUrl, sessionId } = await stripeClient.createCheckoutSession({
        orderId,
        amountBani: totalBani,
        currency: product.currency ? product.currency.toUpperCase() : 'RON',
        description: `${product.name} x${quantity}`,
        buyerEmail: trimmedEmail,
        successUrl: `${BASE_URL}/raspunde.html?order=${orderId}`,
        cancelUrl: `${BASE_URL}/?canceled=1`,
      });
      if (sessionId) {
        db.prepare(`UPDATE orders SET stripe_session_id = ? WHERE id = ?`).run(sessionId, orderId);
      }
      return res.json({ url: redirectUrl });
    }

    const { redirectUrl, payuOrderId } = await payu.createOrder({
      orderId,
      amountBani: totalBani,
      feeBani,
      currency: product.currency ? product.currency.toUpperCase() : 'RON',
      description: `${product.name} x${quantity}`,
      customerIp: req.ip,
      notifyUrl: `${BASE_URL}/payu/notificare`,
      continueUrl: `${BASE_URL}/raspunde.html?order=${orderId}`,

    });

    if (payuOrderId) {
      db.prepare(`UPDATE orders SET payu_order_id = ? WHERE id = ?`).run(payuOrderId, orderId);
    }
    res.json({ url: redirectUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la initierea platii.' });
  }
});

app.get('/api/order/:id', async (req, res) => {
  let order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost gasita.' });

  // Notificarile PayU/Stripe ar trebui sa actualizeze deja starea comenzii,
  // dar pastram si o verificare directa la interogare, ca plasa de siguranta
  // (de exemplu daca notificarea nu a ajuns inca sau serverul nu era
  // accesibil public in momentul respectiv).
  if (order.status === 'pending' && order.payment_method === 'stripe' && stripeClient) {
    try {
      const result = order.stripe_session_id
        ? await stripeClient.getSessionStatus(order.stripe_session_id)
        : await stripeClient.getSessionStatusByOrderId(order.id);
      if (result.paid) {
        markOrderPaidStripe(order.id, result.sessionId || order.stripe_session_id);
        order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      } else if (result.sessionId && !order.stripe_session_id) {
        db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(result.sessionId, order.id);
      }
    } catch (err) {
      console.error('Nu am putut verifica starea comenzii la Stripe:', err.message);
    }
  } else if (order.status === 'pending' && payu) {
    try {
      const result = order.payu_order_id
        ? await payu.getOrderStatus(order.payu_order_id)
        : await payu.getOrderStatusByExtOrderId(order.id);
      if (result.status === 'COMPLETED') {
        markOrderPaid(order.id, result.payuOrderId || order.payu_order_id);
        order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      } else if (result.payuOrderId && !order.payu_order_id) {
        db.prepare('UPDATE orders SET payu_order_id = ? WHERE id = ?').run(result.payuOrderId, order.id);
      }
    } catch (err) {
      console.error('Nu am putut verifica starea comenzii la PayU:', err.message);
    }
  }

  if (order.status === 'pending') return res.json({ status: 'pending' });

  const tickets = orderTicketNumbers(order.id);

  if (order.unlocked) {
    return res.json({
      status: 'unlocked',
      downloadUrl: `${BASE_URL}/descarca/${order.download_token}`,
      tickets,
      quantity: order.quantity,
      invoiceLink: order.invoice_link || null,
    });
  }
  if (order.status === 'locked') {
    return res.json({ status: 'locked', message: 'Ai epuizat numarul de incercari.', tickets, quantity: order.quantity });
  }

  let question;
  if (order.current_question) {
    question = JSON.parse(order.current_question);
  } else {
    question = generateQuestion();
    db.prepare('UPDATE orders SET current_question = ? WHERE id = ?').run(JSON.stringify(question), order.id);
  }

  res.json({
    status: 'paid',
    attemptsLeft: order.attempts_left,
    question: { text: question.text, options: question.options },
    tickets,
    quantity: order.quantity,
  });
});

app.post('/api/answer', (req, res) => {
  const { orderId, selectedIndex } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost gasita.' });
  if (order.status !== 'paid') return res.status(400).json({ error: 'Comanda nu este in starea corecta.' });
  if (!order.current_question) return res.status(400).json({ error: 'Nu exista o intrebare activa pentru aceasta comanda.' });

  const question = JSON.parse(order.current_question);
  const correct = question.correctIndex === selectedIndex;

  if (correct) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare(`UPDATE orders SET unlocked = 1, status = 'unlocked', download_token = ? WHERE id = ?`).run(token, orderId);
    return res.json({
      correct: true,
      downloadUrl: `${BASE_URL}/descarca/${token}`,
      invoiceLink: order.invoice_link || null,
    });
  }

  const attemptsLeft = order.attempts_left - 1;
  if (attemptsLeft <= 0) {
    db.prepare(`UPDATE orders SET attempts_left = 0, status = 'locked' WHERE id = ?`).run(orderId);
    return res.json({
      correct: false,
      attemptsLeft: 0,
      message: 'Ai epuizat numarul de incercari. Contacteaza-ne pentru rezolvare (rambursare sau o noua sansa).',
    });
  }

  const nextQuestion = generateQuestion();
  db.prepare(`UPDATE orders SET attempts_left = ?, current_question = ? WHERE id = ?`).run(
    attemptsLeft,
    JSON.stringify(nextQuestion),
    orderId
  );
  res.json({ correct: false, attemptsLeft, nextQuestion: { text: nextQuestion.text, options: nextQuestion.options } });
});

app.get('/descarca/:token', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE download_token = ?').get(req.params.token);
  if (!order || !order.unlocked) return res.status(404).send('Link invalid sau expirat.');
  if (order.downloads_used >= MAX_DOWNLOADS) {
    return res.status(410).send('Ai atins numarul maxim de descarcari pentru acest link. Contacteaza-ne.');
  }
  const product = getProduct(order.product_id);
  if (!product) return res.status(404).send('Produsul nu mai exista.');
  const numbers = orderTicketNumbers(order.id);
  if (!numbers.length) return res.status(500).send('Nu exista numere alocate pentru aceasta comanda.');

  const seller = getSeller(product.seller_id);
  db.prepare('UPDATE orders SET downloads_used = downloads_used + 1 WHERE id = ?').run(order.id);

  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="bilete-${product.id.slice(0, 8)}.pdf"`);
  streamTicketsPdf(
    { productName: product.name, sellerName: seller ? seller.name : '', buyerName: order.buyer_name, numbers },
    res
  );
});

app.get('/bilet/:orderId/:number.svg', (req, res) => {
  const { orderId, number } = req.params;
  const ticket = db
    .prepare('SELECT * FROM tickets WHERE order_id = ? AND number = ?')
    .get(orderId, parseInt(number, 10));
  if (!ticket) return res.status(404).send('Bilet inexistent.');
  const product = getProduct(ticket.product_id);
  const seller = product ? getSeller(product.seller_id) : null;
  const svg = renderTicketSvg({
    number: ticket.number,
    productName: product ? product.name : '',
    sellerName: seller ? seller.name : '',
  });
  res.set('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// =============================================================================
// API VANZATORI
// =============================================================================

app.post('/api/vanzator/inregistrare', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ error: 'Nume, email si o parola de cel putin 8 caractere sunt obligatorii.' });
    }
    if (getSellerByEmail(email)) return res.status(400).json({ error: 'Exista deja un cont cu acest email.' });

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    // Spre deosebire de Stripe Connect (unde un cont se crea automat printr-un
    // apel API), inscrierea unui vanzator la PayU se face printr-un formular
    // separat (boarding) la care vanzatorul e trimis din dashboard. Aici doar
    // rezervam un id extern stabil, folosit mai tarziu ca extCustomerId.
    const payuExtCustomerId = `vanzator-${id}`;
    db.prepare(
      `INSERT INTO sellers (id, name, email, password_hash, payu_ext_customer_id) VALUES (?, ?, ?, ?, ?)`
    ).run(id, name, String(email).toLowerCase().trim(), passwordHash, payuExtCustomerId);

    if (mailer) {
      mailer
        .sendEmail({
          to: String(email).toLowerCase().trim(),
          subject: 'Bine ai venit - contul tau de vanzator a fost creat',
          html: `
            <p>Salut ${escapeHtml(name)},</p>
            <p>Contul tau de vanzator pe platforma a fost creat cu succes.</p>
            <p>Ultimul pas ca produsele tale sa devina vizibile public: conecteaza-ti contul de plata PayU din panoul tau de vanzator.</p>
          `,
        })
        .catch((err) => console.error('Nu am putut trimite emailul de bun venit catre vanzator:', err.message));
    }

    setSellerCookie(res, id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la inregistrare.' });
  }
});

app.post('/api/vanzator/login', async (req, res) => {
  const { email, password } = req.body;
  const seller = getSellerByEmail(email || '');
  if (!seller) return res.status(401).json({ error: 'Email sau parola gresita.' });
  const ok = await bcrypt.compare(password || '', seller.password_hash);
  if (!ok) return res.status(401).json({ error: 'Email sau parola gresita.' });
  setSellerCookie(res, seller.id);
  res.json({ ok: true });
});

// Recuperare parola: vanzatorul primeste pe email un link cu un token
// aleatoriu, valabil 1 ora, cu care isi poate seta o parola noua.
app.post('/api/vanzator/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const seller = getSellerByEmail(email || '');
    // Raspuns identic indiferent daca emailul exista, ca sa nu se poata
    // deduce ce conturi sunt inregistrate pe platforma.
    if (seller) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE sellers SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
        .run(token, expires, seller.id);
      if (mailer) {
        const link = `${BASE_URL}/vanzator/reset-parola.html?token=${token}`;
        mailer
          .sendEmail({
            to: seller.email,
            subject: 'Resetare parola cont vanzator',
            html: `
              <p>Salut ${escapeHtml(seller.name)},</p>
              <p>Am primit o cerere de resetare a parolei pentru contul tau de vanzator.</p>
              <p><a href="${link}">Apasa aici ca sa-ti setezi o parola noua</a></p>
              <p>Linkul este valabil 1 ora. Daca nu ai cerut tu resetarea, poti ignora acest email.</p>
            `,
          })
          .catch((err) => console.error('Nu am putut trimite emailul de resetare parola:', err.message));
      }
    }
    res.json({ ok: true, message: 'Daca exista un cont cu acest email, vei primi un link de resetare.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la cererea de resetare.' });
  }
});

app.post('/api/vanzator/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'Token invalid sau parola prea scurta (minim 8 caractere).' });
    }
    const seller = db.prepare('SELECT * FROM sellers WHERE reset_token = ?').get(token);
    if (!seller || !seller.reset_token_expires || new Date(seller.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Linkul de resetare este invalid sau a expirat. Cere unul nou.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE sellers SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
      .run(passwordHash, seller.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la resetarea parolei.' });
  }
});

app.post('/api/vanzator/logout', (req, res) => {
  clearSellerCookie(res);
  res.json({ ok: true });
});

// Vanzatorul isi poate schimba numele afisat public (langa produsele lui).
app.post('/api/vanzator/nume', requireSeller, (req, res) => {
  try {
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'Numele nu poate fi gol.' });
    if (name.length > 80) return res.status(400).json({ error: 'Numele este prea lung.' });
    db.prepare('UPDATE sellers SET name = ? WHERE id = ?').run(name, req.seller.id);
    res.json({ ok: true, name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la actualizarea numelui.' });
  }
});

app.get('/api/vanzator/me', requireSeller, async (req, res) => {
  let seller = req.seller;
  if (payu && seller.payu_ext_customer_id) {
    try {
      const { verified } = await payu.checkSellerStatus(seller.payu_ext_customer_id);
      if (verified !== !!seller.payu_verified) {
        db.prepare('UPDATE sellers SET payu_verified = ? WHERE id = ?').run(verified ? 1 : 0, seller.id);
        seller = getSeller(seller.id);
      }
    } catch (err) {
      console.error('Nu am putut verifica statusul vanzatorului la PayU:', err.message);
    }
  }
  res.json({
    id: seller.id,
    name: seller.name,
    email: seller.email,
    payuConnected: !!seller.payu_ext_customer_id,
    payuVerified: !!seller.payu_verified,
    payuConfigured: !!payu,
  });
});

app.get('/api/vanzator/payu/link', requireSeller, async (req, res) => {
  if (!payu) return res.status(500).json({ error: 'PayU nu este configurat pe server.' });
  const seller = req.seller;
  const url = payu.createBoardingLink(seller.payu_ext_customer_id, 'ro');
  res.json({ url });
});

app.get('/api/vanzator/payu/retur', async (req, res) => {
  const sellerId = getSellerIdFromReq(req);
  if (sellerId && payu) {
    const seller = getSeller(sellerId);
    if (seller && seller.payu_ext_customer_id) {
      try {
        const { verified } = await payu.checkSellerStatus(seller.payu_ext_customer_id);
        db.prepare('UPDATE sellers SET payu_verified = ? WHERE id = ?').run(verified ? 1 : 0, seller.id);
      } catch (err) {
        console.error(err);
      }
    }
  }
  res.redirect('/vanzator/dashboard.html?payu=verificat');
});

app.get('/api/vanzator/produse', requireSeller, (req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC').all(req.seller.id);
  res.json(rows.map((p) => ({ ...publicProduct(p), active: !!p.active })));
});

app.post(
  '/api/vanzator/produse',
  requireSeller,
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  (req, res) => {
    try {
      const { name, description, priceRon, stoc } = req.body;
      const stockTotal = parseInt(stoc, 10);

      if (!name || !priceRon || isNaN(parseFloat(priceRon)) || parseFloat(priceRon) <= 0) {
        return res.status(400).json({ error: 'Numele si un pret valid sunt obligatorii.' });
      }
      if (!stockTotal || stockTotal < 1) {
        return res.status(400).json({ error: 'Stocul (numarul de bucati disponibile) trebuie sa fie cel putin 1.' });
      }

      const productId = uuidv4();

      db.prepare(
        `INSERT INTO products (id, seller_id, name, description, price_bani, currency, image_path, stock_total)
         VALUES (?, ?, ?, ?, ?, 'ron', ?, ?)`
      ).run(
        productId,
        req.seller.id,
        name,
        description || '',
        Math.round(parseFloat(priceRon) * 100),
        req.file ? req.file.filename : null,
        stockTotal
      );

      res.json({ ok: true, productId }); notifyNewProduct({ name, price_bani: Math.round(parseFloat(priceRon) * 100) }).catch((err) => console.error('Eroare la trimiterea notificarilor WhatsApp:', err.message)); notifyPushSubscribers({ name, price_bani: Math.round(parseFloat(priceRon) * 100) }).catch((err) => console.error('Eroare la trimiterea notificarilor push:', err.message));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Eroare la salvarea produsului.' });
    }
  }
);

app.post('/api/vanzator/produse/:id/toggle', requireSeller, (req, res) => {
  const product = getProduct(req.params.id);
  if (!product || product.seller_id !== req.seller.id) return res.status(404).json({ error: 'Produs inexistent.' });
  db.prepare('UPDATE products SET active = ? WHERE id = ?').run(product.active ? 0 : 1, product.id);
  res.json({ ok: true, active: !product.active });
});

// Evidenta achizitiilor - vanzatorul vede doar comenzile pentru produsele lui.
app.get('/api/vanzator/comenzi', requireSeller, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, p.name as product_name
       FROM orders o JOIN products p ON p.id = o.product_id
       WHERE o.seller_id = ? AND o.status IN ('paid','locked','unlocked')
       ORDER BY o.created_at DESC`
    )
    .all(req.seller.id);
  res.json(
    rows.map((o) => ({
      id: o.id,
      productName: o.product_name,
      buyerName: o.buyer_name,
      buyerPhone: o.buyer_phone,
      buyerEmail: o.buyer_email,
      buyerAddress: o.buyer_address,
      quantity: o.quantity,
      status: o.status,
      amountBani: o.amount_bani,
      tickets: orderTicketNumbers(o.id),
      createdAt: o.created_at,
      invoiceLink: o.invoice_link || null,
      invoiceNumber: o.invoice_number || null,
    }))
  );
});

// =============================================================================
// API ADMIN - acces complet la toate comenzile, de la toti vanzatorii
// =============================================================================

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Admin neconfigurat (lipseste ADMIN_PASSWORD din .env).' });
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Parola gresita.' });
  setAdminCookie(res);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/comenzi', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, p.name as product_name, s.name as seller_name, s.email as seller_email
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN sellers s ON s.id = o.seller_id
       WHERE o.status IN ('paid','locked','unlocked')
       ORDER BY o.created_at DESC`
    )
    .all();
  res.json(
    rows.map((o) => ({
      id: o.id,
      productName: o.product_name,
      sellerName: o.seller_name,
      sellerEmail: o.seller_email,
      buyerName: o.buyer_name,
      buyerPhone: o.buyer_phone,
      buyerEmail: o.buyer_email,
      buyerAddress: o.buyer_address,
      quantity: o.quantity,
      status: o.status,
      amountBani: o.amount_bani,
      platformFeeBani: o.platform_fee_bani,
      tickets: orderTicketNumbers(o.id),
      createdAt: o.created_at,
      invoiceLink: o.invoice_link || null,
      invoiceNumber: o.invoice_number || null,
    }))
  );
});

// Trimite (o singura data, la cerere din panoul de admin) un email
// personalizat catre toti clientii care au facut deja o achizitie, cu
// numerele lor valabile la Concursul de abilitate si stocul ramas la
// produsul cumparat - folosit pentru a recupera clientii care nu au primit
// inca aceasta confirmare si pentru a crea urgenta legata de stocul limitat.
app.post('/api/admin/trimite-mail-numere', requireAdmin, (req, res) => {
  if (!mailer) return res.status(400).json({ ok: false, error: 'Email-ul nu este configurat (RESEND_API_KEY).' });

  const rows = db
    .prepare(
      `SELECT o.id, o.buyer_name, o.buyer_email, o.product_id, p.name as product_name, p.stock_total
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.status IN ('paid','locked','unlocked') AND o.buyer_email IS NOT NULL AND o.buyer_email <> ''
       ORDER BY o.created_at ASC`
    )
    .all();

  // Grupam comenzile pe email (normalizat), ca un client cu mai multe
  // comenzi/produse sa primeasca un singur email cu toate numerele lui.
  const byEmail = new Map();
  for (const o of rows) {
    const email = o.buyer_email.trim().toLowerCase();
    if (!email.includes('@')) continue;
    if (!byEmail.has(email)) byEmail.set(email, { name: o.buyer_name, products: new Map() });
    const entry = byEmail.get(email);
    if (!entry.name && o.buyer_name) entry.name = o.buyer_name;
    if (!entry.products.has(o.product_id)) {
      const assigned = ticketsAssignedCount(o.product_id);
      entry.products.set(o.product_id, {
        name: o.product_name,
        remaining: Math.max(0, o.stock_total - assigned),
        stockTotal: o.stock_total,
        numbers: [],
      });
    }
    entry.products.get(o.product_id).numbers.push(...orderTicketNumbers(o.id));
  }

  const list = Array.from(byEmail.entries());
  res.json({
    ok: true,
    total: list.length,
    message: 'Trimiterea a pornit in fundal - verifica jurnalele serverului pentru progres.',
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  (async () => {
    let sent = 0;
    let failed = 0;
    for (const [email, data] of list) {
      const firstName = (data.name || '').trim().split(/\s+/)[0] || '';
      const blocks = Array.from(data.products.values())
        .map(
          (p) => `
        <p>
          <strong>${escapeHtml(p.name)}</strong> - numarul (numerele) dumneavoastra: <strong>${p.numbers.join(', ')}</strong><br/>
          Stoc ramas: ${p.remaining} din ${p.stockTotal} disponibile
        </p>`
        )
        .join('');
      try {
        await mailer.sendEmail({
          to: email,
          subject: 'Numerele tale la Concursul de abilitate - stocul se epuizeaza in curand',
          html: `
            <p>Buna ziua${firstName ? ', ' + escapeHtml(firstName) : ''}!</p>
            <p>Ne-am intors la dumneavoastra cu numerele valabile pentru Concursul de abilitate:</p>
            ${blocks}
            <p>Va uram succes! Ramaneti cu ochii pe telefon - stocul se epuizeaza in curand.</p>
            <p>Daca mai vreti sa prindeti cateva numere inainte sa se termine stocul, ne gasiti pe <a href="${BASE_URL}/">${BASE_URL}</a>.</p>
            <p>Cu succes,<br/>Echipa Marita Show</p>
          `,
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error('Nu am putut trimite emailul cu numere catre ' + email + ':', err.message);
      }
      await sleep(550);
    }
    console.log(`Trimitere bulk numere terminata: ${sent} trimise, ${failed} esuate din ${list.length}.`);
  })();
});

// Lista tuturor vanzatorilor inregistrati, cu numarul de produse (active/
// total) - ca sa poata fi gestionati (ex. dezactivat produsele unui cont)
// din panoul de admin.
app.get('/api/admin/vanzatori', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.email,
              COUNT(p.id) as total_products,
              SUM(CASE WHEN p.active = 1 THEN 1 ELSE 0 END) as active_products
       FROM sellers s
       LEFT JOIN products p ON p.seller_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at ASC`
    )
    .all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      totalProducts: r.total_products,
      activeProducts: r.active_products || 0,
    }))
  );
});

// Dezactiveaza/activeaza dintr-o data toate produsele unui vanzator (ex.
// pentru a-i scoate produsele de pe vitrina publica, fara sa se stearga
// nimic din baza de date - actiune complet reversibila).
app.post('/api/admin/vanzatori/:id/produse-active', requireAdmin, (req, res) => {
  const seller = getSeller(req.params.id);
  if (!seller) return res.status(404).json({ error: 'Vanzator inexistent.' });
  const active = req.body && req.body.active ? 1 : 0;
  const result = db.prepare('UPDATE products SET active = ? WHERE seller_id = ?').run(active, seller.id);
  res.json({ ok: true, updated: result.changes });
});

// Statistici generale pentru dashboard-ul de admin: o privire de ansamblu
// rapida asupra a ce se intampla pe site (vanzatori, produse, comenzi, incasari).
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const sellers = db.prepare('SELECT COUNT(*) as c FROM sellers').get().c;
  const products = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active FROM products').get();
  const orders = db
    .prepare(`SELECT COUNT(*) as total, COALESCE(SUM(amount_bani), 0) as revenue FROM orders WHERE status IN ('paid','locked','unlocked')`)
    .get();
  const today = db
    .prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(amount_bani), 0) as revenue FROM orders
       WHERE status IN ('paid','locked','unlocked') AND date(created_at) = date('now')`
    )
    .get();
  res.json({
    sellers,
    totalProducts: products.total || 0,
    activeProducts: products.active || 0,
    totalOrders: orders.total || 0,
    revenueBani: orders.revenue || 0,
    ordersToday: today.total || 0,
    revenueTodayBani: today.revenue || 0,
  });
});

// Toate produsele, de la toti vanzatorii, cu cate s-au vandut si cati bani au
// adus - ca sa poti vedea dintr-o privire ce merge bine si sa extragi
// cumparatorii unui anumit produs.
app.get('/api/admin/produse', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.price_bani, p.stock_total, p.active, p.created_at,
              s.name as seller_name,
              (SELECT COUNT(*) FROM tickets t WHERE t.product_id = p.id) as sold,
              (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id AND o.status IN ('paid','locked','unlocked')) as order_count,
              (SELECT COALESCE(SUM(o.amount_bani), 0) FROM orders o WHERE o.product_id = p.id AND o.status IN ('paid','locked','unlocked')) as revenue_bani
       FROM products p
       JOIN sellers s ON s.id = p.seller_id
       ORDER BY p.created_at DESC`
    )
    .all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      priceBani: r.price_bani,
      stockTotal: r.stock_total,
      active: !!r.active,
      sellerName: r.seller_name,
      sold: r.sold,
      orderCount: r.order_count,
      revenueBani: r.revenue_bani,
      createdAt: r.created_at,
    }))
  );
});

// Extrage (CSV) toti cumparatorii confirmati ai unui produs - nume, telefon,
// email, cantitate, numerele biletelor, data si suma platita.
app.get('/api/admin/produse/:id/export.csv', requireAdmin, (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).send('Produs inexistent.');
  const orders = db
    .prepare(
      `SELECT * FROM orders WHERE product_id = ? AND status IN ('paid','locked','unlocked') ORDER BY created_at ASC`
    )
    .all(product.id);

  const csvField = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  const header = ['Data', 'Nume client', 'Telefon', 'Email', 'Adresa', 'Cantitate', 'Numere bilete', 'Suma (RON)', 'Status'];
  const lines = [header.map(csvField).join(',')];
  for (const o of orders) {
    const numbers = orderTicketNumbers(o.id).join('; ');
    lines.push(
      [
        o.created_at,
        o.buyer_name || '',
        o.buyer_phone || '',
        o.buyer_email || '',
        o.buyer_address || '',
        o.quantity,
        numbers,
        (o.amount_bani / 100).toFixed(2),
        o.status,
      ]
        .map(csvField)
        .join(',')
    );
  }
  const csv = '﻿' + lines.join('\r\n');
  const safeName = String(product.name || 'produs').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cumparatori-${safeName}.csv"`);
  res.send(csv);
});

// Toate numerele posibile ale unui produs (1..stock_total), cu starea lor:
// achizitionat (legat de o comanda platita) sau neachizitionat inca.
app.get('/api/admin/produse/:id/numere', requireAdmin, (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produs inexistent.' });
  const tickets = db
    .prepare(
      `SELECT t.number, o.buyer_name, o.buyer_phone, o.id as order_id, o.created_at
       FROM tickets t JOIN orders o ON o.id = t.order_id
       WHERE t.product_id = ?`
    )
    .all(product.id);
  const byNumber = new Map(tickets.map((t) => [t.number, t]));
  const numbers = [];
  for (let n = 1; n <= product.stock_total; n++) {
    const t = byNumber.get(n);
    numbers.push({
      number: n,
      purchased: !!t,
      buyerName: t ? t.buyer_name || null : null,
      buyerPhone: t ? t.buyer_phone || null : null,
      orderId: t ? t.order_id : null,
      purchasedAt: t ? t.created_at : null,
    });
  }
  res.json({
    product: { id: product.id, name: product.name, stockTotal: product.stock_total },
    numbers,
  });
});

// Webhook Meta pentru WhatsApp: Meta face un GET de verificare o singura
// data, la configurarea callback-ului in App Dashboard (trebuie sa
// raspundem cu hub.challenge daca hub.verify_token se potriveste cu
// WHATSAPP_WEBHOOK_VERIFY_TOKEN). Apoi trimite POST-uri cu evenimente,
// inclusiv mesajele primite de la clienti.
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && WHATSAPP_WEBHOOK_VERIFY_TOKEN && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/api/whatsapp/webhook', (req, res) => {
  try {
    const entries = (req.body && req.body.entry) || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const messages = (change.value && change.value.messages) || [];
        for (const msg of messages) {
          const from = msg.from || '';
          let body = '[mesaj fara text]';
          if (msg.text && msg.text.body) body = msg.text.body;
          else if (msg.button && msg.button.text) body = msg.button.text;
          else if (msg.type) body = `[mesaj de tip ${msg.type}]`;
          const insertInfo = db.prepare('INSERT OR IGNORE INTO whatsapp_messages (id, wa_message_id, from_phone, body) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), msg.id || null, from, body);
          if (insertInfo.changes > 0) {
            notifyAdminNewWhatsappMessage(from, body).catch((err) => console.error('Eroare la trimiterea push-ului de admin:', err.message));
          }
        }
      }
    }
  } catch (err) {
    console.error('Eroare la procesarea webhook-ului WhatsApp:', err.message);
  }
  // Meta cere intotdeauna raspuns 200 rapid, altfel reincearca trimiterea.
  res.sendStatus(200);
});

app.post('/api/admin/push-subscribe', requireAdmin, (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: 'Abonament push invalid.' });
  }
  try {
    db.prepare('INSERT INTO admin_push_subscriptions (id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth')
      .run(uuidv4(), sub.endpoint, sub.keys.p256dh, sub.keys.auth);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la abonare push pentru admin.' });
  }
});

app.get('/api/admin/whatsapp-mesaje', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM whatsapp_messages ORDER BY received_at DESC LIMIT 500').all();
  res.json(
    rows.map((m) => ({
      id: m.id,
      fromPhone: m.from_phone,
      body: m.body,
      receivedAt: m.received_at,
      direction: m.direction || 'in',
    }))
  );
});

// Trimite un raspuns manual catre un client, din panoul de admin. Functioneaza
// doar daca WhatsApp e configurat (variabilele META_WHATSAPP_TOKEN si
// META_PHONE_NUMBER_ID) si, pentru mesaj text liber, doar in fereastra de 24h
// de la ultimul mesaj primit de la acel client - vezi lib/whatsapp.js.
app.post('/api/admin/whatsapp-trimite', requireAdmin, async (req, res) => {
  if (!whatsapp) {
    return res.status(500).json({ error: 'WhatsApp nu este configurat (lipsesc variabilele META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID).' });
  }
  const toPhone = req.body && req.body.toPhone;
  const messageBody = req.body && req.body.body;
  if (!toPhone || !messageBody || !String(messageBody).trim()) {
    return res.status(400).json({ error: 'Numarul de telefon si textul mesajului sunt obligatorii.' });
  }
  try {
    await whatsapp.sendText(toPhone, messageBody);
    db.prepare('INSERT INTO whatsapp_messages (id, wa_message_id, from_phone, body, direction) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), null, normalizePhone(toPhone), String(messageBody), 'out');
    res.json({ ok: true });
  } catch (err) {
    console.error('Eroare la trimiterea mesajului WhatsApp din admin:', err.message);
    res.status(500).json({ error: 'Nu am putut trimite mesajul. ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Serverul ruleaza pe ${BASE_URL} (port ${PORT})`);
  if (!payu) console.warn('ATENTIE: variabilele PAYU_* lipsesc din .env - platile prin PayU nu vor functiona.');
  if (!stripeClient) console.warn('ATENTIE: STRIPE_SECRET_KEY lipseste din .env - plata cu cardul prin Stripe nu va functiona.');
  else if (!STRIPE_WEBHOOK_SECRET) console.warn('ATENTIE: STRIPE_WEBHOOK_SECRET lipseste din .env - webhook-ul Stripe nu va putea fi verificat.');
  if (!ADMIN_PASSWORD) console.warn('ATENTIE: ADMIN_PASSWORD lipseste din .env - panoul de admin este dezactivat.');
  if (!oblio) console.warn('ATENTIE: variabilele OBLIO_* lipsesc din .env - facturarea automata este dezactivata.');
  if (!whatsapp) console.warn('ATENTIE: variabilele META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID lipsesc din .env - notificarile WhatsApp la produs nou sunt dezactivate.');
  if (!WHATSAPP_WEBHOOK_VERIFY_TOKEN) console.warn('ATENTIE: WHATSAPP_WEBHOOK_VERIFY_TOKEN lipseste din .env - webhook-ul de primire mesaje WhatsApp nu va putea fi verificat de Meta.');
  if (whatsapp) {
    // Verificam din 15 in 15 minute daca exista comenzi mai vechi de 24h
    // care nu au primit inca reminder-ul WhatsApp cu stocul ramas.
    checkAndSendPurchaseReminders().catch((err) => console.error('Eroare la reminder-ul WhatsApp de 24h:', err.message));
    setInterval(() => {
      checkAndSendPurchaseReminders().catch((err) => console.error('Eroare la reminder-ul WhatsApp de 24h:', err.message));
    }, 15 * 60 * 1000);
  } else {
    console.warn('ATENTIE: reminder-ul WhatsApp de 24h este dezactivat (WhatsApp neconfigurat).');
  }
});
