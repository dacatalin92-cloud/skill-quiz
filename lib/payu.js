// Integrare cu PayU Romania (PayU GPO Europe REST API), inlocuind Stripe.
//
// Sursa documentatiei folosite (verifica intotdeauna varianta curenta pe
// developers.payu.com inainte de a lansa in productie — API-urile de plati
// se pot schimba):
//  - Autentificare + creare comanda: https://developers.payu.com/europe/docs/get-started/accept-payment/
//  - Split intre vanzatori (marketplace): https://developers.payu.com/europe/docs/services/marketplace/integration/
//  - Inscrierea vanzatorilor (boarding): https://developers.payu.com/europe/docs/services/marketplace/boarding/
//  - Notificari si semnatura: https://developers.payu.com/europe/docs/payment-flows/lifecycle/
//  - Sandbox: https://developers.payu.com/europe/docs/testing/sandbox/
//
// IMPORTANT: acest modul a fost scris pe baza documentatiei publice PayU,
// dar NU a putut fi testat cu apeluri reale catre serverele PayU din acest
// mediu de dezvoltare (acces de retea restrictionat). Testeaza-l cu atentie
// cu datele tale reale de sandbox inainte de a accepta plati live — vezi
// README.md, sectiunea despre PayU.

const crypto = require('crypto');

function makePayU({ posId, clientId, clientSecret, secondKey, sandbox, marketplacePartnerId }) {
  const baseUrl = sandbox ? 'https://secure.snd.payu.com' : 'https://secure.payu.com';

  let cachedToken = null;
  let cachedTokenExpiresAt = 0;

  async function getAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiresAt - 5000) return cachedToken;

    const res = await fetch(`${baseUrl}/pl/standard/user/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`PayU OAuth a esuat (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    cachedToken = data.access_token;
    cachedTokenExpiresAt = Date.now() + (data.expires_in || 300) * 1000;
    return cachedToken;
  }

  // Creeaza o comanda de plata. Daca `sellerExtCustomerId` e furnizat, banii
  // se impart automat: vanzatorul primeste (amountBani - feeBani), iar
  // diferenta (feeBani) ramane platformei — echivalentul application_fee
  // de la Stripe Connect.
  async function createOrder({
    orderId,
    amountBani,
    feeBani,
    currency,
    description,
    buyerEmail,
    customerIp,
    notifyUrl,
    continueUrl,
    sellerExtCustomerId,
  }) {
    const token = await getAccessToken();

    const body = {
      merchantPosId: posId,
      notifyUrl,
      continueUrl,
      customerIp: customerIp || '127.0.0.1',
      description: description || 'Comanda',
      currencyCode: currency || 'RON',
      totalAmount: String(amountBani),
      extOrderId: orderId,
      buyer: buyerEmail ? { email: buyerEmail, extCustomerId: orderId } : undefined,
    };

    if (sellerExtCustomerId) {
      body.shoppingCarts = [
        {
          extCustomerId: sellerExtCustomerId,
          amount: amountBani,
          fee: feeBani || 0,
          products: [{ name: description || 'Produs', unitPrice: amountBani, quantity: 1 }],
        },
      ];
    } else {
      body.products = [{ name: description || 'Produs', unitPrice: amountBani, quantity: 1 }];
    }

    const res = await fetch(`${baseUrl}/api/v2_1/orders`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // PayU raspunde fie cu 302 + header Location catre pagina de plata,
    // fie cu 200/201 + JSON continand redirectUri — tratam ambele cazuri.
    const location = res.headers.get('location');
    if (location) {
      return { redirectUrl: location, payuOrderId: null };
    }
    const data = await res.json().catch(() => null);
    if (!data) throw new Error(`Raspuns neasteptat de la PayU la crearea comenzii (status ${res.status}).`);
    if (!data.redirectUri) {
      throw new Error(`PayU nu a returnat un link de plata: ${JSON.stringify(data)}`);
    }
    return { redirectUrl: data.redirectUri, payuOrderId: data.orderId || null };
  }

  async function getOrderStatus(payuOrderId) {
    const token = await getAccessToken();
    const res = await fetch(`${baseUrl}/api/v2_1/orders/${payuOrderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Nu am putut verifica starea comenzii PayU (${res.status}).`);
    const data = await res.json();
    const order = data.orders && data.orders[0];
    return { status: order ? order.status : null, payuOrderId: order ? order.orderId : null };
  }

  // Fallback pentru cazul (frecvent, conform documentatiei) in care crearea
  // comenzii raspunde cu 302 + Location, fara corp JSON cu orderId — atunci nu
  // avem payuOrderId salvat, dar putem interoga starea dupa extOrderId (id-ul
  // nostru intern de comanda), pe care PayU il accepta ca parametru de query.
  async function getOrderStatusByExtOrderId(extOrderId) {
    const token = await getAccessToken();
    const res = await fetch(`${baseUrl}/api/v2_1/orders?extOrderId=${encodeURIComponent(extOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Nu am putut verifica starea comenzii PayU dupa extOrderId (${res.status}).`);
    const data = await res.json();
    const order = data.orders && data.orders[0];
    return { status: order ? order.status : null, payuOrderId: order ? order.orderId : null };
  }

  // Verifica semnatura headerului "OpenPayu-Signature" pe notificari.
  // Format header: "sender=checkout;signature=...;algorithm=MD5;content=DOCUMENT"
  function verifyNotifySignature(rawBody, signatureHeader) {
    if (!signatureHeader) return false;
    const parts = Object.fromEntries(
      signatureHeader.split(';').map((p) => {
        const [k, v] = p.split('=');
        return [k && k.trim(), v && v.trim()];
      })
    );
    const algorithm = (parts.algorithm || 'MD5').toLowerCase();
    const expected = crypto
      .createHash(algorithm === 'md5' ? 'md5' : 'sha256')
      .update(rawBody + secondKey)
      .digest('hex');
    if (!parts.signature) return false;
    const a = Buffer.from(parts.signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // Link de inscriere pentru un vanzator nou (Web Form Boarding). Functioneaza
  // doar pentru persoane juridice (firme), pana la 20 de vanzatori simultan —
  // pentru mai multi vanzatori sau persoane fizice e nevoie de fluxul complet
  // prin API-ul de verificare AML/KYC al PayU (nu este inclus aici).
  function createBoardingLink(sellerExtCustomerId, lang) {
    const partnerId = marketplacePartnerId || posId;
    const params = new URLSearchParams({
      lang: lang || 'ro',
      nsf: 'false',
      partnerId: String(partnerId),
      marketplaceExtCustomerId: sellerExtCustomerId,
    });
    // Documentatia publica arata acest link pe domeniul de productie
    // (secure.payu.com) chiar si pentru testare — nu am putut confirma cu
    // certitudine un echivalent separat pe secure.snd.payu.com pentru
    // sandbox. Confirma exact acest URL cu reprezentantul tau PayU cand
    // primesti acces real la contul de marketplace.
    return `https://secure.payu.com/boarding/#/form?${params.toString()}`;
  }

  async function checkSellerStatus(extCustomerId) {
    const token = await getAccessToken();
    const res = await fetch(`${baseUrl}/api/v2_1/customers/ext/${encodeURIComponent(extCustomerId)}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return { verified: false, raw: null };
    if (!res.ok) throw new Error(`Nu am putut verifica statusul vanzatorului la PayU (${res.status}).`);
    const data = await res.json();
    const status = (data.status || data.verificationStatus || '').toString().toLowerCase();
    return { verified: status.includes('verif') || status === 'positive', raw: data };
  }

  return {
    getAccessToken,
    createOrder,
    getOrderStatus,
    getOrderStatusByExtOrderId,
    verifyNotifySignature,
    createBoardingLink,
    checkSellerStatus,
  };
}

module.exports = { makePayU };
