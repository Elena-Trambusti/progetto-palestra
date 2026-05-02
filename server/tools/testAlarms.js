#!/usr/bin/env node
/**
 * Strumento di test per simulare errori manutenzione
 * Verifica che il sistema gestisca gracefulmente casi limite
 * 
 * Uso:
 *   node server/tools/testAlarms.js --battery-critical node-water-01
 *   node server/tools/testAlarms.js --node-offline node-air-01
 *   node server/tools/testAlarms.js --battery-ok node-water-01 (ripristino)
 *   npm run test:alarms
 */

const { checkSingleNodeBattery } = require('../lib/batteryAlerts');
const { checkSingleNodeNetwork } = require('../lib/networkAlerts');
const { isTelegramConfigured } = require('../lib/telegram');

// Simula store dei nodi
const mockStore = {};

function showUsage() {
  console.log(`
Test Allarmi Manutenzione - Uso:
  node testAlarms.js [opzione] [nodeId]

Opzioni:
  --battery-critical <nodeId>   Simula batteria al 10% (dovrebbe inviare notifica CRITICO)
  --battery-warning <nodeId>  Simula batteria al 20% (dovrebbe inviare notifica WARNING)
  --battery-ok <nodeId>         Simula batteria al 80% (dovrebbe inviare ripristino)
  --node-offline <nodeId>       Simula nodo non risponde da 15 min
  --node-online <nodeId>        Simula nodo tornato online (ripristino)
  --list                        Lista nodi configurati

Esempi:
  node testAlarms.js --battery-critical node-water-01
  node testAlarms.js --node-offline node-air-01

Note:
  - Richiede TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID configurati
  - TELEGRAM_AUTO_MONITOR=true per vedere i monitoraggi partire
  - Altrimenti il test verifica solo la logica interna
`);
}

function listNodes() {
  const { NODES } = require('../lib/zonesData');
  console.log('\nNodi configurati:');
  NODES.forEach(n => {
    console.log(`  - ${n.id}: ${n.label} (${n.zoneId})`);
  });
  console.log('');
}

async function testBattery(nodeId, level) {
  const batteryPercent = level === 'critical' ? 10 : level === 'warning' ? 20 : 80;
  
  console.log(`[test] Simulazione batteria ${level}: ${nodeId} = ${batteryPercent}%`);
  
  // Simula store con batteria
  mockStore[nodeId] = { batteryPercent };
  
  // Esegui check
  const result = await checkSingleNodeBattery(nodeId, batteryPercent);
  
  console.log(`[test] Risultato:`, result);
  
  if (result.notified) {
    console.log(`[test] ✓ Notifica inviata per ${nodeId}`);
  } else {
    console.log(`[test] ℹ Nessuna notifica (cooldown attivo o livello ok)`);
  }
}

async function testNodeOffline(nodeId, offline = true) {
  const minutesAgo = offline ? 15 : 0;
  const uplinkAt = offline 
    ? new Date(Date.now() - minutesAgo * 60000).toISOString()
    : new Date().toISOString();
  
  console.log(`[test] Simulazione nodo ${offline ? 'OFFLINE' : 'ONLINE'}: ${nodeId}`);
  console.log(`[test] Ultimo contatto: ${offline ? minutesAgo + ' minuti fa' : 'ora'}`);
  
  // Simula store
  mockStore[nodeId] = { 
    uplinkAt,
    rssi: offline ? null : -95,
    snr: offline ? null : 5,
    batteryPercent: 75
  };
  
  // Esegui check
  const result = await checkSingleNodeNetwork(nodeId, mockStore[nodeId]);
  
  console.log(`[test] Risultato:`, result);
  
  if (result.notified) {
    console.log(`[test] ✓ Notifica inviata per ${nodeId}`);
  } else {
    console.log(`[test] ℹ Nessuna notifica (cooldown attivo o stato invariato)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    showUsage();
    process.exit(0);
  }
  
  if (args.includes('--list')) {
    listNodes();
    process.exit(0);
  }
  
  // Verifica Telegram configurato
  if (!isTelegramConfigured()) {
    console.warn('[test] ⚠ Telegram non configurato - notifiche saranno solo loggate');
    console.warn('[test] Impostare TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID per ricevere messaggi');
  } else {
    console.log('[test] ✓ Telegram configurato');
  }
  
  const option = args[0];
  const nodeId = args[1];
  
  if (!nodeId) {
    console.error('[test] ERRORE: specificare nodeId');
    showUsage();
    process.exit(1);
  }
  
  try {
    switch (option) {
      case '--battery-critical':
        await testBattery(nodeId, 'critical');
        break;
      case '--battery-warning':
        await testBattery(nodeId, 'warning');
        break;
      case '--battery-ok':
        await testBattery(nodeId, 'ok');
        break;
      case '--node-offline':
        await testNodeOffline(nodeId, true);
        break;
      case '--node-online':
        await testNodeOffline(nodeId, false);
        break;
      default:
        console.error(`[test] Opzione sconosciuta: ${option}`);
        showUsage();
        process.exit(1);
    }
    
    console.log('[test] Test completato');
    
  } catch (err) {
    console.error('[test] ERRORE durante test:', err.message);
    process.exit(1);
  }
  
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { testBattery, testNodeOffline };
