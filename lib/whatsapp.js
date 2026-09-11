// Client minimal pentru WhatsApp prin Meta Cloud API (WhatsApp Business
// Platform), direct catre Graph API-ul Meta, fara niciun BSP intermediar
// (fara Twilio). Sablonul de mesaj (template) tot trebuie creat si aprobat
// in WhatsApp Manager, la fel ca la orice alt provider peste WhatsApp
// Business Platform.

// Numerele stocate sunt de obicei in format romanesc local (07xxxxxxxx).
// Meta cere numarul in format international, FARA semnul "+" (ex:
// pentru 0750217934 trebuie trimis 40750217934).
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.slice(1);
  if (digits.startsWith('0')) return `4${digits}`;
  if (digits.startsWith('40')) return digits;
  return `40${digits}`;
}

function makeWhatsapp({ accessToken, phoneNumberId, templateName, languageCode }) {
  const lang = languageCode || 'ro';
  const template = templateName || 'produs_nou_disponibil';

  async function sendTemplate(toPhone, params) {
    const to = normalizePhone(toPhone);
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: lang },
        components: [
          {
            type: 'body',
            parameters: params.map((p) => ({ type: 'text', text: String(p) })),
          },
        ],
      },
    };

    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Meta WhatsApp API a raspuns cu eroare (${res.status}): ${errText}`);
    }
    return res.json();
  }

  // Trimite un mesaj text liber (nu un sablon), folosit de admin ca sa
  // raspunda manual clientilor din panoul de mesaje WhatsApp. Meta permite
  // acest tip de mesaj doar in fereastra de 24h de la ultimul mesaj primit
  // de la clientul respectiv ("customer service window") - in afara ei,
  // trebuie folosit un sablon aprobat, la fel ca la notificarea de produs nou.
  async function sendText(toPhone, text) {
    const to = normalizePhone(toPhone);
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: String(text) },
    };

    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Meta WhatsApp API a raspuns cu eroare (${res.status}): ${errText}`);
    }
    return res.json();
  }

  return { sendTemplate, sendText };
}

module.exports = { makeWhatsapp, normalizePhone };
