#!/usr/bin/env node
/**
 * Test Allarmi Telegram - Simula eventi critici per testare il bot
 * 
 * Uso: npm run test:telegram:alarm
 * 
 * Testa 3 tipi di allarme:
 * 1. Livello acqua critico (15%)
 * 2. Batteria scarica (12%)
 * 3. Temperatura elevata (35°C)
 */

const path = require("path");
const rootDir = path.join(__dirname, "..");
const dotenv = require(path.join(rootDir, "server", "node_modules", "dotenv"));

// Carica env
[
  path.join(rootDir, ".env"),
  path.join(rootDir, "server", ".env"),
  path.join(rootDir, ".env.txt"),
  path.join(rootDir, "server", ".env.txt"),
].forEach((p) => dotenv.config({ path: p }));

const {
  notifyCriticalAlarm,
  notifyWarning,
  notifyBatteryAlert,
  notifyNodeOffline,
  notifyWeakSignal,
  notifyRecovery,
} = require(path.join(rootDir, "server", "lib", "telegramNotifier"));

const { isTelegramConfigured } = require(path.join(rootDir, "server", "lib", "telegram"));

async function testAllAlarms() {
  console.log("🧪 Test Allarmi Telegram Bot Intelligente\n");
  console.log("==========================================\n");

  if (!isTelegramConfigured()) {
    console.error("❌ TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID non configurati!");
    console.log("   Impostali in server/.env");
    process.exit(1);
  }

  console.log("✅ Bot configurato correttamente\n");
  console.log("Invio 5 allarmi di test...\n");

  // 1. Allarme CRITICO - Livello acqua basso
  console.log("1️⃣  Invio: Livello acqua critico (15%)...");
  const result1 = await notifyCriticalAlarm({
    zoneId: "serbatoio-idrico",
    zoneName: "Serbatoio Piscina",
    type: "water_critical",
    title: "Livello Acqua Critico",
    message: "La riserva idrica ha raggiunto il 15% (sotto soglia critica 12%).",
    value: 15,
    unit: "%",
    action: "URGENTE: Attivare immediatamente rifornimento o verificare pompe",
  });
  console.log(result1.ok ? "   ✅ Inviato" : `   ⚠️  ${result1.cooldown ? "Cooldown attivo" : "Errore"}`);

  await delay(2000);

  // 2. Allarme WARNING - Temperatura elevata
  console.log("\n2️⃣  Invio: Temperatura elevata (35°C)...");
  const result2 = await notifyWarning({
    zoneId: "sala-pesi-aria",
    zoneName: "Sala Pesi",
    type: "temp_high",
    title: "Temperatura Elevata",
    message: "Temperatura superiore alla soglia di comfort (soglia: 32°C).",
    value: 35.5,
    unit: "°C",
  });
  console.log(result2.ok ? "   ✅ Inviato" : `   ⚠️  ${result2.cooldown ? "Cooldown attivo" : "Errore"}`);

  await delay(2000);

  // 3. Allarme CRITICO - Batteria scarica
  console.log("\n3️⃣  Invio: Batteria scarica (12%)...");
  const result3 = await notifyBatteryAlert({
    nodeId: "node-water-01",
    batteryPercent: 12,
    level: "critical",
  });
  console.log(result3.ok ? "   ✅ Inviato" : `   ⚠️  ${result3.cooldown ? "Cooldown attivo" : "Errore"}`);

  await delay(2000);

  // 4. Allarme CRITICO - Nodo offline
  console.log("\n4️⃣  Invio: Nodo offline da 15 minuti...");
  const result4 = await notifyNodeOffline({
    nodeId: "node-air-01",
    minutesOffline: 15,
  });
  console.log(result4.ok ? "   ✅ Inviato" : `   ⚠️  ${result4.cooldown ? "Cooldown attivo" : "Errore"}`);

  await delay(2000);

  // 5. Allarme WARNING - Segnale debole
  console.log("\n5️⃣  Invio: Segnale radio debole (RSSI -118 dBm)...");
  const result5 = await notifyWeakSignal({
    nodeId: "node-env-01",
    rssi: -118,
    snr: -2,
  });
  console.log(result5.ok ? "   ✅ Inviato" : `   ⚠️  ${result5.cooldown ? "Cooldown attivo" : "Errore"}`);

  await delay(2000);

  // 6. Ripristino - Nodo tornato online (bonus)
  console.log("\n6️⃣  Invio: Ripristino nodo online (bonus)...");
  const result6 = await notifyRecovery({
    nodeId: "node-air-01",
    type: "online",
  });
  console.log(result6.ok ? "   ✅ Inviato" : `   ⚠️  ${result6.cooldown ? "Cooldown attivo" : "Errore"}`);

  console.log("\n==========================================");
  console.log("✅ Test completato! Controlla la chat Telegram.");
  console.log("\n💡 Nota: Se alcuni messaggi non arrivano, potrebbe essere");
  console.log("   il cooldown che impedisce spam. Aspetta 5-15 min e riprova.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

testAllAlarms().catch((err) => {
  console.error("❌ Errore durante il test:", err);
  process.exit(1);
});
