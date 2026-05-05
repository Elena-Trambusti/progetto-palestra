/**
 * Demo Trigger Allarme Critico - Industrial Style
 */
require('dotenv').config();
const { notifyCriticalAlarm } = require("../lib/telegramNotifier");

async function triggerDemo() {
  console.log("Inviando allarme critico simulato per P1 - Palestra...");
  
  const result = await notifyCriticalAlarm({
    zoneId: "P1",
    zoneName: "Palestra",
    type: "CO2_HIGH",
    title: "Livello CO2 Critico",
    message: "Rilevata concentrazione di CO2 oltre i 1500 ppm. La qualità dell'aria è scarsa.",
    value: 1580,
    unit: " ppm",
    action: "Attivare ventilazione forzata e aprire le finestre del piano P1."
  });

  if (result.ok) {
    console.log("✅ Allarme inviato con successo!");
  } else {
    console.log("❌ Errore invio (o cooldown attivo):", result.skipped ? "Skipped (Config)" : "Cooldown");
  }
  process.exit(0);
}

triggerDemo();
