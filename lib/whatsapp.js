const WHATSAPP_API_VERSION = 'v20.0';

// Client minimal pentru WhatsApp Cloud API (Meta). Trimite mesaje folosind un
// sablon (template) aprobat in prealabil de Meta - mesajele initiate de
// afacere catre clienti in afara ferestrei de 24h necesita un sablon aprobat,
// nu text liber.
function makeWhatsapp({ token, phoneNumberId, templateName, templateLang }) {
  async function sendTemplate(toPhone, params) {
    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
    const digits = String(toPhone || '').replace(/[^\d+]/g, '');
    const body = {
      messaging_product: 'whatsapp',
      to: digits,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [
          {
            type: 'body',
            parameters: params.map((p) => ({ type: 'text', text: String(p) })),
          },
          ],
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WhatsApp API a raspuns cu eroare (${res.status}): ${errText}`);
    }
    return res.json();
  }

return { sendTemplate };
}

module.exports = { makeWhatsapp };
