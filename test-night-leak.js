require('dotenv').config({path: '.env'});
const { notifyCriticalAlarm } = require('./server/lib/telegramNotifier');

console.log('🚨 TEST PERDITA NOTTURNA - SESTO SENSO');
console.log('Simulazione diretta allarme perdita notturna...');

// Simulazione manuale dell'allarme di perdita notturna
const nightTime = new Date();
nightTime.setHours(3, 15, 0, 0); // 03:15

const flowLmin = 0.5; // Flusso anomalo notturno
const nightHoursEnd = 5; // 05:00
const nightHoursStart = 1; // 01:00
const currentHour = nightTime.getHours();

// Logica di rilevamento perdita notturna
const isNightTime = currentHour >= nightHoursStart && currentHour < nightHoursEnd;
const isAnomalousFlow = flowLmin > 0.1; // soglia minima notturna

console.log(`\n📊 Analisi:`);
console.log(`- Orario: ${currentHour}:15 (notturno: ${isNightTime})`);
console.log(`- Flusso: ${flowLmin} L/min (anomalo: ${isAnomalousFlow})`);

if (isNightTime && isAnomalousFlow) {
  // Calcolo spreco stimato
  const minutesToEnd = (nightHoursEnd - currentHour) * 60;
  const estimatedWaste = Math.round(flowLmin * minutesToEnd);
  
  console.log(`\n🚨 ALLARME PERDITA NOTTURNA RILEVATO!`);
  console.log(`💧 Spreco stimato: ${estimatedWaste} litri`);
  
  // Invio notifica Telegram
  const alertMessage = `🚨 PERDITA NOTTURNA RILEVATA\n\n` +
    `📍 Nodo: node-flow-01 (Linea flusso)\n` +
    `⏰ Orario: ${currentHour}:15\n` +
    `💧 Flusso anomalo: ${flowLmin} L/min\n` +
    `💰 Spreco stimato: ${estimatedWaste} litri\n\n` +
    `⚠️ Controllare immediatamente la linea idrica!`;
  
  console.log(`\n📱 Invio notifica Telegram...`);
  
  notifyCriticalAlarm({
    title: "PERDITA NOTTURNA - Sesto Senso",
    message: alertMessage,
    nodeId: "node-flow-01",
    estimatedWaste: estimatedWaste
  }).then(() => {
    console.log(`✅ Notifica inviata con successo!`);
    console.log(`📱 Controlla la tua chat Telegram: -5200524561`);
  }).catch(err => {
    console.error(`❌ Errore invio notifica:`, err.message);
  });
  
} else {
  console.log(`\n✅ Nessuna perdita notturna rilevata`);
}
