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
const { makeMailer, escapeHtml } = require('./lib/mailer');
const { generateQuestion } = require('./lib/questionGenerator');
const { renderTicketSvg } = require('./lib/ticketImage');
const { streamTicketsPdf } = require('./lib/ticketPdf'); const { makeWhatsapp } = require('./lib/whatsapp');

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

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const mailer = makeMailer({ apiKey: RESEND_API_KEY, from: RESEND_FROM }); const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''; const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''; const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || ''; const TWILIO_CONTENT_SID = process.env.TWILIO_CONTENT_SID || ''; const whatsappConfigured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM && TWILIO_CONTENT_SID); const whatsapp = whatsappConfigured ? makeWhatsapp({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN, from: TWILIO_WHATSAPP_FROM, contentSid: TWILIO_CONTENT_SID }) : null;

const upload = makeImageUploader(); function getNotificationPhones() { const subs = db.prepare('SELECT phone FROM subscribers').all().map((r) => r.phone); const buyers = db.prepare("SELECT DISTINCT buyer_phone as phone FROM orders WHERE buyer_phone IS NOT NULL AND status IN ('paid','locked','unlocked')").all().map((r) => r.phone); return [...new Set([...subs, ...buyers].filter(Boolean))]; } async function notifyNewProduct(product) { if (!whatsapp) return; const phones = getNotificationPhones(); const priceText = (product.price_bani / 100).toFixed(2) + ' RON'; const link = BASE_URL + '/'; for (const phone of phones) { try { await whatsapp.sendTemplate(phone, [product.name, priceText, link]); } catch (err) { console.error('Nu am putut trimite WhatsApp catre ' + phone + ':', err.message); } } }

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

app.use(express.json()); app.post('/api/abonare', (req, res) => { const digits = req.body && req.body.phone ? String(req.body.phone).replace(/\D/g, '') : ''; if (!digits || digits.length < 9) { return res.status(400).json({ error: 'Un numar de telefon valid este obligatoriu.' }); } try { db.prepare('INSERT OR IGNORE INTO subscribers (id, phone) VALUES (?, ?)').run(uuidv4(), String(req.body.phone).trim()); res.json({ ok: true }); } catch (err) { console.error(err); res.status(500).json({ error: 'Eroare la abonare.' }); } });
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

function markOrderPaid(orderId, payuOrderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'pending') return;
  if (payuOrderId) {
    db.prepare(`UPDATE orders SET status = 'paid', payu_order_id = ? WHERE id = ?`).run(payuOrderId, orderId);
  } else {
    db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(orderId);
  }
  assignTickets(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId));
  sendOrderConfirmationEmail(order);
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

app.post('/api/checkout', async (req, res) => {
  try {
    if (!payu) return res.status(500).json({ error: 'PayU nu este configurat pe server (vezi .env).' });
    const { productId, name, phone, email } = req.body;
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
      `INSERT INTO orders (id, product_id, seller_id, buyer_name, buyer_phone, buyer_email, quantity, attempts_left, amount_bani, platform_fee_bani)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(orderId, product.id, seller.id, String(name).trim(), String(phone).trim(), trimmedEmail, quantity, MAX_ATTEMPTS, totalBani, feeBani);

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

  // Notificarile PayU ar trebui sa actualizeze deja starea comenzii, dar
  // pastram si o verificare directa la interogare, ca plasa de siguranta
  // (de exemplu daca notificarea nu a ajuns inca sau serverul nu era
  // accesibil public in momentul respectiv).
  if (order.status === 'pending' && payu) {
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
    return res.json({ correct: true, downloadUrl: `${BASE_URL}/descarca/${token}` });
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

app.post('/api/vanzator/logout', (req, res) => {
  clearSellerCookie(res);
  res.json({ ok: true });
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

      res.json({ ok: true, productId }); notifyNewProduct({ name, price_bani: Math.round(parseFloat(priceRon) * 100) }).catch((err) => console.error('Eroare la trimiterea notificarilor WhatsApp:', err.message));
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
      quantity: o.quantity,
      status: o.status,
      amountBani: o.amount_bani,
      tickets: orderTicketNumbers(o.id),
      createdAt: o.created_at,
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
      quantity: o.quantity,
      status: o.status,
      amountBani: o.amount_bani,
      platformFeeBani: o.platform_fee_bani,
      tickets: orderTicketNumbers(o.id),
      createdAt: o.created_at,
    }))
  );
});

app.listen(PORT, () => {
  console.log(`Serverul ruleaza pe ${BASE_URL} (port ${PORT})`);
  if (!payu) console.warn('ATENTIE: variabilele PAYU_* lipsesc din .env - platile prin PayU nu vor functiona.');
  if (!ADMIN_PASSWORD) console.warn('ATENTIE: ADMIN_PASSWORD lipseste din .env - panoul de admin este dezactivat.');
});
