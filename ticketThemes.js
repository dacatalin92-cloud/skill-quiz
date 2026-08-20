// Seturi de culori si modele decorative pentru biletele numerotate. Fiecare
// numar primeste un design determinist (acelasi numar arata mereu la fel),
// combinand o paleta de culori cu un model decorativ — ca biletele sa nu
// arate toate identic.

const PALETTES = [
  { name: 'aurora', from: '#1a1233', to: '#0f1115', accent: '#8c6cff', accent2: '#ff6cf0' },
  { name: 'forest', from: '#0f2418', to: '#0f1115', accent: '#35c26b', accent2: '#a4f0bb' },
  { name: 'sunset', from: '#331a12', to: '#0f1115', accent: '#ff8a3d', accent2: '#ffd166' },
  { name: 'ocean', from: '#0d2733', to: '#0f1115', accent: '#3dd6ff', accent2: '#6c8cff' },
  { name: 'berry', from: '#2b1030', to: '#0f1115', accent: '#ff5c9d', accent2: '#ff8a3d' },
  { name: 'gold', from: '#2b2210', to: '#0f1115', accent: '#ffd166', accent2: '#ff8a3d' },
];

const MOTIFS = ['dots', 'rings', 'stripes'];

function themeForNumber(number) {
  const n = Math.max(0, parseInt(number, 10) || 0);
  const palette = PALETTES[n % PALETTES.length];
  const motif = MOTIFS[Math.floor(n / PALETTES.length) % MOTIFS.length];
  return { ...palette, motif };
}

module.exports = { PALETTES, MOTIFS, themeForNumber };
