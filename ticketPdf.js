const PDFDocument = require('pdfkit');
const { themeForNumber } = require('./ticketThemes');

function drawMotif(doc, theme, width, height) {
  doc.save();
  if (theme.motif === 'rings') {
    const cx = width - 60;
    const cy = 60;
    for (let i = 0; i < 5; i++) {
      doc.circle(cx, cy, 20 + i * 16)
        .lineWidth(2)
        .strokeOpacity(0.22 - i * 0.035)
        .stroke(theme.accent2);
    }
  } else if (theme.motif === 'stripes') {
    doc.strokeOpacity(0.09);
    for (let x = -height; x < width; x += 26) {
      doc.moveTo(x, 0).lineTo(x + height, height).lineWidth(6).stroke(theme.accent);
    }
  } else {
    doc.fillOpacity(0.13);
    const cols = 7;
    const rows = 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 18 + c * (width / cols) + (r % 2) * 14;
        const y = 18 + r * (height / rows);
        doc.circle(x, y, 2.4).fill(theme.accent);
      }
    }
  }
  doc.restore();
}

// Genereaza pe loc (fara sa scrie fisier pe disk) PDF-ul livrat clientului:
// cate o pagina pentru fiecare numar alocat comenzii sale, fiecare cu un
// design diferit (culoare + model decorativ), ales determinist dupa numar.
function streamTicketsPdf({ productName, sellerName, buyerName, numbers }, res) {
  const doc = new PDFDocument({ size: 'A5', margin: 0 });
  doc.pipe(res);

  numbers.forEach((number, idx) => {
    if (idx > 0) doc.addPage({ size: 'A5', margin: 0 });

    const { width, height } = doc.page;
    const theme = themeForNumber(number);

    const bg = doc.linearGradient(0, 0, width, height);
    bg.stop(0, theme.from).stop(1, theme.to);
    doc.rect(0, 0, width, height).fill(bg);

    drawMotif(doc, theme, width, height);

    doc.roundedRect(16, 16, width - 32, height - 32, 16).lineWidth(1.5).strokeOpacity(0.5).stroke(theme.accent);
    doc.strokeOpacity(1);

    doc.fillColor('#c7cbd4').fontSize(13).font('Helvetica')
      .text('BILET DE PARTICIPARE', 0, 60, { align: 'center' });

    doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
      .text(productName || 'Produs', 40, 90, { align: 'center', width: width - 80 });

    if (sellerName) {
      doc.fillColor('#c7cbd4').fontSize(11).font('Helvetica')
        .text(`Vanzator: ${sellerName}`, 40, 122, { align: 'center', width: width - 80 });
    }

    doc.fillColor(theme.accent).fontSize(64).font('Helvetica-Bold')
      .text(`#${String(number).padStart(4, '0')}`, 0, height / 2 - 40, { align: 'center' });

    doc.fillColor('#c7cbd4').fontSize(10).font('Helvetica')
      .text(`Numar ${idx + 1} din ${numbers.length}${buyerName ? ' · ' + buyerName : ''}`, 0, height - 60, {
        align: 'center',
      });
  });

  doc.end();
}

module.exports = { streamTicketsPdf };
