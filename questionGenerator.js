// Genereaza automat o intrebare simpla de calcul, ca sa nu mai fie nevoie ca
// vanzatorul sa scrie el intrebari. Intrebarea e stocata direct in comanda
// (nu intr-o banca separata), asa ca fiecare incercare primeste o intrebare
// noua, la intamplare.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateQuestion() {
  const a = randomInt(2, 12);
  const b = randomInt(2, 12);
  const useAddition = Math.random() < 0.5;
  const correct = useAddition ? a + b : a * b;
  const text = useAddition ? `Cat fac ${a} + ${b}?` : `Cat fac ${a} x ${b}?`;

  const distractors = new Set();
  while (distractors.size < 3) {
    const offset = randomInt(-5, 5);
    const candidate = correct + offset;
    if (offset !== 0 && candidate >= 0 && candidate !== correct) {
      distractors.add(candidate);
    }
  }

  const options = shuffle([correct, ...distractors]).map(String);
  const correctIndex = options.indexOf(String(correct));

  return { text, options, correctIndex };
}

module.exports = { generateQuestion };
