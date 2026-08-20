// Genereaza o imagine SVG pentru un bilet numerotat — nu necesita nicio
// librarie externa de grafica. Fiecare numar primeste un design diferit
// (culoare + model decorativ), ales determinist din lib/ticketThemes.js.

const { themeForNumber } = require('./ticketThemes');

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[ch]));
}

function motifDots(theme) {
  let shapes = '';
  const cols = 10;
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = 20 + c * 60 + ((r % 2) * 30);
      const cy = 20 + r * 50;
      shapes += `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${theme.accent}" opacity="0.12"/>`;
    }
  }
  return shapes;
}

function motifRings(theme) {
  let shapes = '';
  const cx = 560;
  const cy = 40;
  for (let i = 0; i < 5; i++) {
    shapes += `<circle cx="${cx}" cy="${cy}" r="${18 + i * 16}" fill="none" stroke="${theme.accent2}" stroke-width="2" opacity="${0.22 - i * 0.035}"/>`;
  }
  return shapes;
}

function motifStripes(theme) {
  let shapes = '';
  for (let x = -260; x < 600; x += 34) {
    shapes += `<line x1="${x}" y1="0" x2="${x + 260}" y2="260" stroke="${theme.accent}" stroke-width="6" opacity="0.07"/>`;
  }
  return shapes;
}

function renderMotif(theme) {
  if (theme.motif === 'rings') return motifRings(theme);
  if (theme.motif === 'stripes') return motifStripes(theme);
  return motifDots(theme);
}

function renderTicketSvg({ number, productName, sellerName }) {
  const title = escapeXml(productName || 'Produs');
  const sub = escapeXml(sellerName || '');
  const numberText = String(number).padStart(4, '0');
  const theme = themeForNumber(number);
  const gradId = `bg-${number}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260" viewBox="0 0 600 260">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.from}"/>
      <stop offset="100%" stop-color="${theme.to}"/>
    </linearGradient>
    <clipPath id="clip-${number}"><rect x="0" y="0" width="600" height="260" rx="18"/></clipPath>
  </defs>
  <g clip-path="url(#clip-${number})">
    <rect x="0" y="0" width="600" height="260" fill="url(#${gradId})"/>
    ${renderMotif(theme)}
  </g>
  <rect x="1" y="1" width="598" height="258" rx="17" fill="none" stroke="${theme.accent}" stroke-width="1.5" opacity="0.5"/>
  <circle cx="0" cy="130" r="14" fill="#0b0d11"/>
  <circle cx="600" cy="130" r="14" fill="#0b0d11"/>
  <line x1="430" y1="20" x2="430" y2="240" stroke="${theme.accent}" stroke-width="1.5" stroke-dasharray="6,6" opacity="0.4"/>

  <text x="34" y="56" font-family="Arial, sans-serif" font-size="20" fill="#c7cbd4">Bilet de participare</text>
  <text x="34" y="98" font-family="Arial, sans-serif" font-size="28" fill="#ffffff" font-weight="bold">${title}</text>
  <text x="34" y="128" font-family="Arial, sans-serif" font-size="16" fill="#c7cbd4">${sub}</text>

  <text x="515" y="115" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="#c7cbd4">NR.</text>
  <text x="515" y="160" text-anchor="middle" font-family="Arial, sans-serif" font-size="46" fill="${theme.accent}" font-weight="bold">${escapeXml(numberText)}</text>
</svg>`;
}

module.exports = { renderTicketSvg };
