// Client minimal pentru WhatsApp prin Twilio (un BSP - Business Solution
// Provider - peste WhatsApp Business Platform). Twilio simplifica interfata
// si administrarea fata de Meta direct, dar sablonul de mesaj (Content
// Template) tot trebuie aprobat prin fluxul Twilio<->Meta, la fel ca la
// integrarea directa cu Meta Cloud API.

// Numerele stocate sunt de obicei in format romanesc local (07xxxxxxxx).
// Twilio cere format international E.164 (+40xxxxxxxxx).
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return `+4${digits}`;
  return `+40${digits}`;
}

function makeWhatsapp({ accountSid, authToken, from, contentSid }) {
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

async function sendTemplate(toPhone, params) {
  const to = normalizePhone(toPhone);
  const variables = {};
  params.forEach((p, i) => {
    variables[String(i + 1)] = String(p);
  });

  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:${to}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables),
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio API a raspuns cu eroare (${res.status}): ${errText}`);
  }
  return res.json();
}

return { sendTemplate };
}

module.exports = { makeWhatsapp };
