const PDFDocument = require('pdfkit');
const cron = require('node-cron');
const { fetchTopology, fetchLatestMeasurements } = require('./postgresStore');
const { sendTelegramDocument, isTelegramConfigured } = require('./telegram');

/**
 * Genera un report PDF in memoria (Buffer)
 */
async function generatePdfReport() {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // Intestazione
      doc.fontSize(20).text('Misuratore dati LORA', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(14).text('Report Giornaliero', { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(10).text(`Generato il: ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`, { align: 'center' });
      doc.moveDown(2);

      // Recupera topologia e misurazioni
      const topo = await fetchTopology();
      const nodeIds = topo.nodes.map(n => n.id);
      
      let measurements = {};
      if (nodeIds.length > 0) {
        measurements = await fetchLatestMeasurements(nodeIds);
      }

      // Raggruppa per zona
      const zonesWithNodes = topo.zones.map(zone => {
        return {
          ...zone,
          nodes: topo.nodes.filter(n => n.zoneId === zone.id)
        };
      });

      for (const zone of zonesWithNodes) {
        doc.fontSize(14).fillColor('#0055A4').text(`Zona: ${zone.name}`, { underline: true });
        doc.moveDown(0.5);
        doc.fillColor('black');

        if (zone.nodes.length === 0) {
          doc.fontSize(10).text('Nessun sensore installato in questa zona.');
          doc.moveDown(1);
          continue;
        }

        for (const node of zone.nodes) {
          const lastMeas = measurements[node.id] || null;
          doc.fontSize(12).text(`Sensore: ${node.label} (${node.id})`);
          doc.fontSize(10);
          if (lastMeas) {
            const timeStr = lastMeas.timestamp ? new Date(lastMeas.timestamp).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : 'Sconosciuto';
            doc.text(`- Ultimo aggiornamento: ${timeStr}`);
            if (lastMeas.value !== undefined) doc.text(`- Valore principale: ${lastMeas.value}`);
            if (lastMeas.battery !== undefined) doc.text(`- Batteria: ${lastMeas.battery}%`);
            if (lastMeas.co2 !== undefined) doc.text(`- CO2: ${lastMeas.co2} ppm`);
            if (lastMeas.voc !== undefined) doc.text(`- VOC: ${lastMeas.voc}`);
          } else {
            doc.text('- Nessuna misurazione recente.');
          }
          doc.moveDown(0.5);
        }
        doc.moveDown(1);
      }

      // Footer
      doc.fontSize(10).text('Documento generato automaticamente. Non rispondere a questo messaggio.', 50, doc.page.height - 50, { align: 'center', color: 'grey' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Invia il report via Telegram
 */
async function sendDailyReport() {
  if (!isTelegramConfigured()) {
    console.log('[pdfReporter] Telegram non configurato, skip report PDF.');
    return;
  }
  
  console.log('[pdfReporter] Generazione report PDF in corso...');
  try {
    const pdfBuffer = await generatePdfReport();
    const filename = `Report_LORA_${new Date().toISOString().split('T')[0]}.pdf`;
    const caption = "📊 <b>Ecco il report aggiornato dei sensori</b>\nGenerato automaticamente dal sistema <i>Misuratore dati LORA</i>.";
    
    console.log('[pdfReporter] Invio documento Telegram...');
    const res = await sendTelegramDocument(pdfBuffer, filename, caption);
    if (res.ok) {
      console.log('[pdfReporter] Report inviato con successo.');
    } else {
      console.log('[pdfReporter] Fallito invio report.');
    }
  } catch (err) {
    console.error('[pdfReporter] Errore durante la generazione o invio:', err);
  }
}

/**
 * Inizializza lo scheduler
 */
function startReportScheduler() {
  // Configura cron per l'invio tutti i giorni alle 08:00
  cron.schedule('0 8 * * *', () => {
    console.log('[pdfReporter] Esecuzione cron job giornaliero...');
    sendDailyReport();
  });
  console.log('[pdfReporter] Scheduler attivato (08:00 ogni giorno).');
}

module.exports = {
  generatePdfReport,
  sendDailyReport,
  startReportScheduler
};
