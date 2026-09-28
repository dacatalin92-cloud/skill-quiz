// Client minimal pentru WhatsApp prin Meta Cloud API (WhatsApp Business
// Platform), direct catre Graph API-ul Meta, fara niciun BSP intermediar
// (fara Twilio). Sablonul de mesaj (template) tot trebuie creat si aprobat
// in WhatsApp Manager, la fel ca la orice alt provider peste WhatsApp
// Business Platform.

// Numerele cumparatorilor sunt de obicei introduse in format romanesc local
// (07xxxxxxxx), dar numerele care ne scriu pe WhatsApp (webhook-ul de
// mesaje primite, folosit si cand adminul raspunde intr-o conversatie
// existenta) ne vin deja de la Meta in format international complet, FARA
// "+" (ex: 447586218640, sau 16315551181 pentru numarul de test Meta) - nu
// mai au nevoie de niciun prefix. Distingem cele doua cazuri strict: doar un
// numar care are EXACT forma unui numar romanesc local (0 + 9 cifre) primeste
// prefixul de tara 40; orice alt numar e lasat neschimbat, ca sa nu-l stricam
// adaugand gresit un "40" peste un numar deja international (asta trimitea
// mesajele catre un numar inexistent si separa conversatia in doua fire).
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  // Prefixul international "00" (ex: 0040712345678) e echivalent cu "+" -
  // fara el, numarul ar ajunge trimis gresit (0040... in loc de 40...).
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^0\d{9}$/.test(digits)) return `4${digits}`;
  return digits;
}

// Verificare minimala, la introducerea datelor (abonare/checkout): un numar
// de telefon nu contine niciodata litere - asta prinde din start valori
// clar gresite (ex: un link lipit din greseala in campul de telefon), care
// altfel ar trece de simpla verificare "are cel putin 9 cifre" (un link cu
// un ID/UUID in el are oricum destule cifre ca sa pace acel test).
function isPlausiblePhone(raw) {
  const str = String(raw || '').trim();
  if (!str || /[a-zA-Z]/.test(str)) return false;
  const digits = str.replace(/[^\d]/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function makeWhatsapp({ accessToken, phoneNumberId, templateName, languageCode }) {
  const lang = languageCode || 'ro';
  const template = templateName || 'produs_nou_disponibil';

  // opts.headerImageUrl - daca sablonul are un antet de tip imagine (ex:
  // reminder-ul de stoc, cu poza produsului), trimite link-ul public al
  // imaginii aici. opts.headerDocumentUrl - la fel, dar pentru un antet de
  // tip document (ex: livrarea biletului PDF pe WhatsApp) - opts.headerDocumentFilename
  // controleaza numele fisierului asa cum il vede clientul (implicit
  // "bilete.pdf"). opts.templateName - suprascrie sablonul implicit, pentru
  // cazurile in care aceeasi conexiune WhatsApp trimite mai multe tipuri de
  // sabloane (produs nou, reminder stoc, bilet digital etc).
  async function sendTemplate(toPhone, params, opts = {}) {
    const to = normalizePhone(toPhone);
    const components = [];
    if (opts.headerImageUrl) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: opts.headerImageUrl } }],
      });
    } else if (opts.headerDocumentUrl) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: { link: opts.headerDocumentUrl, filename: opts.headerDocumentFilename || 'bilete.pdf' },
          },
        ],
      });
    }
    components.push({
      type: 'body',
      parameters: params.map((p) => ({ type: 'text', text: String(p) })),
    });
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: opts.templateName || template,
        language: { code: lang },
        components,
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

module.exports = { makeWhatsapp, normalizePhone, isPlausiblePhone };
