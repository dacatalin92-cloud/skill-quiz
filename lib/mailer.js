// Trimite email-uri tranzactionale prin Resend (https://resend.com), folosind
// doar fetch (fara dependinta noua de npm), la fel ca lib/payu.js.
//
// Cum obtii o cheie API: creezi cont gratuit pe resend.com, apoi
// Api Keys -> Create API Key. Fara un domeniu propriu verificat pe Resend,
// poti trimite doar catre adresa de email cu care ti-ai facut contul
// (folosind "from" implicit onboarding@resend.dev) - suficient pentru
// testare. Pentru a trimite catre clienti reali, verifica un domeniu pe
// resend.com/domains si seteaza RESEND_FROM cu o adresa de pe acel domeniu.

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeMailer({ apiKey, from }) {
  if (!apiKey) return null;
  const fromAddress = from || 'onboarding@resend.dev';

  async function sendEmail({ to, subject, html }) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress, to, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Resend a raspuns cu ${res.status}: ${text}`);
    }
    return res.json();
  }

  return { sendEmail };
}

module.exports = { makeMailer, escapeHtml };
