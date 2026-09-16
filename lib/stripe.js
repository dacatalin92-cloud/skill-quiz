// Integrare cu Stripe Checkout, ca a doua metoda de plata pe langa PayU.
// Foloseste SDK-ul oficial "stripe" (npm) - Checkout Session in modul
// "payment" (plata unica), cu redirect catre pagina hosted de Stripe,
// la fel ca fluxul existent pentru PayU (redirectUrl).
//
// Documentatie: https://docs.stripe.com/checkout/quickstart
//               https://docs.stripe.com/webhooks

const Stripe = require('stripe');

function makeStripe({ secretKey, webhookSecret }) {
  const stripe = new Stripe(secretKey);

  // Creeaza o Checkout Session pentru o comanda. Stripe primeste suma totala
  // ca un singur produs (quantity 1), la fel cum face si integrarea PayU -
  // cantitatea aleasa de client e deja inclusa in `amountBani`.
  async function createCheckoutSession({
    orderId,
    amountBani,
    currency,
    description,
    buyerEmail,
    successUrl,
    cancelUrl,
  }) {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: (currency || 'ron').toLowerCase(),
            product_data: { name: description || 'Comanda' },
            unit_amount: amountBani,
          },
          quantity: 1,
        },
      ],
      customer_email: buyerEmail || undefined,
      client_reference_id: orderId,
      metadata: { orderId },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return { redirectUrl: session.url, sessionId: session.id };
  }

  async function getSessionStatus(sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return { paid: session.payment_status === 'paid', status: session.status, sessionId: session.id };
  }

  async function getSessionStatusByOrderId(orderId) {
    const sessions = await stripe.checkout.sessions.list({ limit: 1 });
    // Stripe nu suporta filtrare directa a listei de sesiuni dupa
    // client_reference_id/metadata prin API - fallback-ul de interogare
    // directa nu e disponibil ca la PayU (extOrderId). In practica statusul
    // e actualizat prin webhook (checkout.session.completed); acest fallback
    // e util doar imediat dupa checkout, cand clientul se intoarce pe site.
    const found = sessions.data.find((s) => s.client_reference_id === orderId || (s.metadata && s.metadata.orderId === orderId));
    if (!found) return { paid: false, status: null, sessionId: null };
    return { paid: found.payment_status === 'paid', status: found.status, sessionId: found.id };
  }

  // Verifica semnatura webhook-ului Stripe (header "stripe-signature") si
  // reconstruieste evenimentul. `rawBody` trebuie sa fie body-ul RAW
  // (Buffer/string), necesar pentru verificare - la fel ca la PayU.
  function constructWebhookEvent(rawBody, signatureHeader) {
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
  }

  return { createCheckoutSession, getSessionStatus, getSessionStatusByOrderId, constructWebhookEvent };
}

module.exports = { makeStripe };
