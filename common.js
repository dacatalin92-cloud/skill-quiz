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
