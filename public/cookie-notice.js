// Banner de cookie-uri (GDPR / ePrivacy), varianta completa cu alegere
// vizibila "Accepta toate" / "Doar necesare" si un panou de detalii pe
// categorii - ca sa aiba aspectul standard pe care vizitatorii il asteapta
// de la un site serios, nu doar un simplu "Am inteles".
//
// Important: MaritaShow foloseste in prezent DOAR un cookie tehnic, strict
// necesar pentru functionarea si securitatea site-ului - nu avem cookie-uri
// de marketing sau analiza. Textul afisat clientului e formulat general
// (fara detalii interne, ca de exemplu cine anume se autentifica), pentru ca
// e vorba de un cookie care nu il afecteaza personal pe vizitator; detaliul
// tehnic complet (autentificarea vanzatorilor/administratorilor) ramane
// documentat corect in politica de confidentialitate, la sectiunea
// Cookie-uri. De aceea cele doua butoane duc practic la acelasi rezultat din
// punct de vedere tehnic (nu exista nimic "de marketing" de dezactivat), dar
// alegerea si panoul de detalii sunt afisate onest. Daca in viitor se adauga
// cookie-uri de analiza/marketing, alegerea salvata aici (STORAGE_KEY) e
// locul unde se poate verifica inainte de a le incarca.
(function () {
  var STORAGE_KEY = 'cookie_consent_v2';

  function getConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function setConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {
      // Nimic de facut - bannerul va reaparea la vizita urmatoare, fara efecte negative.
    }
    var el = document.getElementById('cookie-notice');
    if (el) el.remove();
  }

  function renderCookieNotice() {
    if (getConsent()) return;
    if (document.getElementById('cookie-notice')) return;

    var el = document.createElement('div');
    el.id = 'cookie-notice';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Setari cookie-uri');
    el.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:9999',
      'background:var(--card,#171a21)', 'border-top:1px solid var(--border,#2a2e38)',
      'padding:16px', 'box-shadow:0 -4px 16px rgba(0,0,0,0.35)',
      'font-size:0.85rem', 'color:var(--muted,#9aa0ab)',
    ].join(';');

    el.innerHTML =
      '<div style="max-width:880px;margin:0 auto;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:center;">' +
        '<span style="max-width:520px;">' +
          'Folosim cookie-uri pentru a-ti oferi o experienta buna si sigura pe site. Cele tehnice, ' +
          'strict necesare pentru functionarea corecta a platformei, sunt mereu active. Nu folosim ' +
          'cookie-uri de marketing sau de analiza. ' +
          '<a href="#" id="cookie-notice-details" style="color:var(--accent,#6c8cff);">Detalii pe categorii</a> &middot; ' +
          '<a href="/politica-confidentialitate.html#cookie-uri" style="color:var(--accent,#6c8cff);">Politica de confidentialitate</a>' +
        '</span>' +
        '<div style="display:flex;gap:10px;flex-shrink:0;">' +
          '<button type="button" id="cookie-notice-necessary" style="width:auto;padding:10px 16px;background:transparent;border:1px solid var(--border,#2a2e38);color:var(--text,#e8eaed);">Doar necesare</button>' +
          '<button type="button" id="cookie-notice-accept" style="width:auto;padding:10px 18px;">Accepta toate</button>' +
        '</div>' +
      '</div>' +
      '<div id="cookie-notice-panel" style="display:none;max-width:880px;margin:14px auto 0;padding-top:14px;border-top:1px solid var(--border,#2a2e38);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:640px;margin:0 auto;">' +
          '<div>' +
            '<strong style="color:var(--text,#e8eaed);">Necesare</strong> - mereu active<br/>' +
            '<span>Esentiale pentru functionarea de baza si securitatea site-ului. Nu pot fi dezactivate. ' +
            'Detalii complete in <a href="/politica-confidentialitate.html#cookie-uri" style="color:var(--accent,#6c8cff);">politica de confidentialitate</a>.</span>' +
          '</div>' +
          '<input type="checkbox" checked disabled style="width:20px;height:20px;flex-shrink:0;accent-color:var(--accent,#6c8cff);" />' +
        '</div>' +
      '</div>';

    document.body.appendChild(el);

    document.getElementById('cookie-notice-accept').addEventListener('click', function () {
      setConsent('all');
    });
    document.getElementById('cookie-notice-necessary').addEventListener('click', function () {
      setConsent('necessary');
    });
    document.getElementById('cookie-notice-details').addEventListener('click', function (ev) {
      ev.preventDefault();
      var panel = document.getElementById('cookie-notice-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
  }

  document.addEventListener('DOMContentLoaded', renderCookieNotice);
})();
