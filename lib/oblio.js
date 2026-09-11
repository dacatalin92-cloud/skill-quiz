// Client minim pentru API-ul Oblio.eu (facturare + e-Factura), la fel de
// simplu ca celelalte integrari din lib/ (mailer.js, whatsapp.js, push.js):
// doar fetch, fara librarii externe. Autentificarea foloseste OAuth2
// client_credentials - un access_token valabil 3600s, pastrat in memorie si
// reinnoit automat cand expira (nu persista intre reporniri ale serverului,
// dar se regenereaza automat la nevoie).

const BASE_URL = 'https://www.oblio.eu/api';

function makeOblio({ email, secret, cif, seriesName }) {
  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function getToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
    const res = await fetch(`${BASE_URL}/authorize/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: email, client_secret: secret, grant_type: 'client_credentials' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error('Nu am putut obtine token Oblio: ' + (data.statusMessage || res.status));
    }
    cachedToken = data.access_token;
    // Reinnoim cu 60s inainte de expirarea reala, ca sa nu folosim niciodata
    // un token expirat din cauza latentei retelei.
    tokenExpiresAt = Date.now() + (Number(data.expires_in || 3600) - 60) * 1000;
    return cachedToken;
  }

  // Creeaza o factura pentru o comanda MaritaShow. Firma este configurata in
  // contul Oblio ca neplatitoare de TVA (Setari > Date firma), asa ca nu
  // trimitem niciun camp legat de TVA - Oblio omite automat linia de TVA.
  async function createInvoice({ buyerName, buyerEmail, buyerPhone, productName, priceRon, quantity, orderId }) {
    const token = await getToken();
    const res = await fetch(`${BASE_URL}/docs/invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        cif,
        seriesName,
        issueDate: new Date().toISOString().slice(0, 10),
        client: {
          name: buyerName || 'Client MaritaShow',
          email: buyerEmail || undefined,
          phone: buyerPhone || undefined,
        },
        products: [
          {
            name: productName,
            price: priceRon,
            quantity: quantity || 1,
            measuringUnit: 'buc',
            currency: 'RON',
          },
        ],
        mentions: orderId ? `Comanda MaritaShow #${orderId}` : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 200 || !data.data) {
      throw new Error('Eroare Oblio la crearea facturii: ' + (data.statusMessage || res.status));
    }
    return {
      seriesName: data.data.seriesName,
      number: data.data.number,
      link: data.data.link,
    };
  }

  return { createInvoice };
}

module.exports = { makeOblio };
