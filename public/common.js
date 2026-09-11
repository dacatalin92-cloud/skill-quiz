// Functie folosita pe toate paginile ca sa afisam in siguranta text introdus
// de vanzatori (nume produs, descriere, intrebari) — platforma e multi-utilizator,
// deci acest continut NU este de incredere si trebuie tratat ca text simplu,
// niciodata ca HTML.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

// Subsol comun cu datele firmei, contact si linkurile legale (termeni,
// confidentialitate, retur). Se injecteaza automat in orice pagina care are
// un element <div id="site-footer"></div> — asa evitam sa duplicam acest
// text in fiecare fisier HTML.
function renderSiteFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.innerHTML = `
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid #2a2e38;">
      <p style="margin:0 0 6px;">
        <a href="/termeni-si-conditii.html" style="color:#6c8cff;">Termeni si conditii</a> ·
        <a href="/politica-confidentialitate.html" style="color:#6c8cff;">Politica de confidentialitate</a> ·
        <a href="/politica-retur.html" style="color:#6c8cff;">Politica de retur</a>
      </p>
      <p style="margin:0 0 4px;">
        TIMI &amp; MARITA SHOW S.R.L. · CUI 51858921 · Nr. inreg. Registrul Comertului J2025037585001<br />
        Sediu social: Sat Baltesti, Comuna Baltesti, Str. Ion I.C. Bratianu, Nr. 127, Jud. Prahova
      </p>
      <p style="margin:0;">
        Contact: <a href="mailto:timimaritashow@gmail.com" style="color:#6c8cff;">timimaritashow@gmail.com</a> · 0750 217 934
      </p>
    </div>
  `;
}
document.addEventListener('DOMContentLoaded', renderSiteFooter);
