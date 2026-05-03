#!/usr/bin/env node
/**
 * Test Sistema Completo - Sesto Senso Manutenzione
 * Simula invio pacchetti TTN per testare telemetria e notifiche
 * 
 * Uso:
 *   node server/tools/test-full-system.js --scenario=battery
 *   node server/tools/test-full-system.js --scenario=co2
 *   node server/tools/test-full-system.js --scenario=signal
 *   node server/tools/test-full-system.js --custom
 *   npm run test:full
 */

// Carica variabili d'ambiente dal .env del server
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Configurazione
const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const INGEST_SECRET = process.env.INGEST_SECRET || process.env.API_KEY || '';

// Tipi sensori predefiniti
const SENSOR_TYPES = {
  AIR: {
    deviceId: 'node-air-01',
    devEui: 'AABBCCDDEEFF0011',
    type: 'ARIA',
    location: 'Sala Pesi',
    fields: ['co2Ppm', 'vocIndex', 'lux', 'temperatureC', 'humidityPercent']
  },
  WATER: {
    deviceId: 'node-flow-01', 
    devEui: 'AABBCCDDEEFF0022',
    type: 'ACQUA',
    location: 'Depuratore',
    fields: ['flowLmin', 'levelPercent', 'temperatureC']
  }
};

// Scenari di test
const SCENARIOS = {
  // Scenario 1: ARIA con CO2 alta, batteria carica
  co2: {
    name: '🌬️  ARIA - CO2 Alta (batteria OK)',
    sensor: SENSOR_TYPES.AIR,
    payload: {
      temperatureC: 23.5,
      humidityPercent: 62,
      co2Ppm: 1850,        // Alta!
      vocIndex: 320,
      lux: 450,
      batteryPercent: 85  // Carica
    },
    rssi: -85,
    snr: 8,
    expectedAlerts: ['Qualità aria: CO2 elevato']
  },
  
  // Scenario 2: ACQUA con flusso normale, batteria scarica
  battery: {
    name: '💧 ACQUA - Batteria Scarica (10%)',
    sensor: SENSOR_TYPES.WATER,
    payload: {
      temperatureC: 18.2,
      levelPercent: 75,
      flowLmin: 12.5,       // Normale
      batteryPercent: 10    // CRITICA!
    },
    rssi: -95,
    snr: 6,
    expectedAlerts: ['Manutenzione: Batteria Scarica']
  },
  
  // Scenario 3: Segnale debole
  signal: {
    name: '📡 SEGNALE DEBOLE - RSSI critico',
    sensor: SENSOR_TYPES.AIR,
    payload: {
      temperatureC: 22.0,
      humidityPercent: 55,
      co2Ppm: 650,         // Normale
      vocIndex: 120,
      lux: 380,
      batteryPercent: 70   // OK
    },
    rssi: -128,           // Critico!
    snr: -2,
    expectedAlerts: ['Manutenzione: Segnale Debole']
  },
  
  // Scenario 4: Tutto OK
  healthy: {
    name: '✅ TUTTO OK - Valori normali',
    sensor: SENSOR_TYPES.WATER,
    payload: {
      temperatureC: 19.5,
      levelPercent: 82,
      flowLmin: 8.2,
      batteryPercent: 78   // OK
    },
    rssi: -82,
    snr: 9,
    expectedAlerts: []
  }
};

/**
 * Costruisce payload TTN realistico
 */
function buildTtnPayload(scenario) {
  const { sensor, payload, rssi, snr } = scenario;
  
  return {
    end_device_ids: {
      device_id: sensor.deviceId,
      application_ids: { application_id: 'palestra-sensori' },
      dev_eui: sensor.devEui,
      join_eui: '0000000000000000'
    },
    uplink_message: {
      f_port: 1,
      f_cnt: Math.floor(Math.random() * 1000),
      frm_payload: Buffer.from(JSON.stringify(payload)).toString('base64'),
      decoded_payload: payload,
      rx_metadata: [{
        gateway_id: 'palestra-gateway-01',
        rssi: rssi,
        snr: snr,
        timestamp: Date.now()
      }],
      metadata: {
        time: new Date().toISOString()
      }
    },
    received_at: new Date().toISOString()
  };
}

/**
 * Invia richiesta HTTP POST
 */
function sendRequest(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    const client = parsed.protocol === 'https:' ? https : http;
    
    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    
    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

/**
 * Esegue uno scenario di test
 */
async function runScenario(scenarioKey) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) {
    console.error(`❌ Scenario sconosciuto: ${scenarioKey}`);
    console.log(`Scenari disponibili: ${Object.keys(SCENARIOS).join(', ')}`);
    return false;
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 TEST: ${scenario.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📡 Sensore: ${scenario.sensor.deviceId} (${scenario.sensor.type})`);
  console.log(`📍 Posizione: ${scenario.sensor.location}`);
  console.log(`📊 Payload:`, JSON.stringify(scenario.payload, null, 2));
  console.log(`📶 RSSI: ${scenario.rssi} dBm | SNR: ${scenario.snr} dB`);
  console.log('');
  
  const ttnPayload = buildTtnPayload(scenario);
  const url = `${API_BASE}/api/ingest`;
  
  const headers = {};
  if (INGEST_SECRET) {
    headers['x-ingest-secret'] = INGEST_SECRET;
    console.log(`🔐 Usando header x-ingest-secret`);
  } else {
    console.log(`⚠️  Nessun INGEST_SECRET configurato - richiesta senza auth`);
  }
  
  try {
    const start = Date.now();
    const response = await sendRequest(url, ttnPayload, headers);
    const duration = Date.now() - start;
    
    console.log(`⏱️  Tempo risposta: ${duration}ms`);
    console.log(`📥 Status: ${response.status}`);
    console.log(`📦 Risposta:`, JSON.stringify(response.data, null, 2));
    
    if (response.status === 200 && response.data.ok) {
      console.log(`\n✅ Scenario completato con successo`);
      if (scenario.expectedAlerts.length > 0) {
        console.log(`🔔 Alert attesi: ${scenario.expectedAlerts.join(', ')}`);
      } else {
        console.log(`✨ Nessun alert atteso (tutto OK)`);
      }
      return true;
    } else {
      console.log(`\n❌ Scenario fallito`);
      return false;
    }
    
  } catch (err) {
    console.error(`\n💥 Errore richiesta:`, err.message);
    return false;
  }
}

/**
 * Test custom interattivo
 */
async function runCustomTest() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔧 TEST CUSTOM`);
  console.log(`${'='.repeat(60)}`);
  console.log('Configura il tuo pacchetto:\n');
  
  // Valori di default
  const customPayload = {
    deviceId: 'node-custom-01',
    devEui: 'AABBCCDDEEFF0099',
    type: 'CUSTOM',
    location: 'Test Area'
  };
  
  // Simula con valori utente (hardcoded per semplicità)
  const payload = {
    temperatureC: 25.0,
    batteryPercent: 15,  // Scarica
    customValue: 123
  };
  
  const scenario = {
    name: 'Test Personalizzato',
    sensor: customPayload,
    payload: payload,
    rssi: -105,
    snr: 3,
    expectedAlerts: ['Manutenzione: Batteria Scarica']
  };
  
  return await runScenario('custom');
}

/**
 * Esegue tutti gli scenari
 */
async function runAllScenarios() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     SESTO SENSO - Test Sistema Manutenzione Completo      ║
╚══════════════════════════════════════════════════════════╝
`);
  console.log(`API Target: ${API_BASE}`);
  console.log(`Auth: ${INGEST_SECRET ? 'Configurato' : 'Nessuno'}`);
  console.log('');
  
  const results = {};
  
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    results[key] = await runScenario(key);
    // Attendi 2 secondi tra i test
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Riepilogo
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 RIEPILOGO TEST`);
  console.log(`${'='.repeat(60)}`);
  
  const passed = Object.entries(results).filter(([_, ok]) => ok);
  const failed = Object.entries(results).filter(([_, ok]) => !ok);
  
  console.log(`\n✅ Superati: ${passed.length}/${Object.keys(results).length}`);
  console.log(`❌ Falliti: ${failed.length}/${Object.keys(results).length}`);
  
  if (failed.length > 0) {
    console.log(`\nTest falliti:`);
    failed.forEach(([key]) => console.log(`  - ${key}`));
  }
  
  console.log(`\n💡 Nota: Verifica le notifiche Telegram per gli alert di manutenzione.`);
  console.log(`   Se TELEGRAM_AUTO_MONITOR=false, i monitoraggi sono disabilitati.`);
  console.log(`   Usa TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID per testare notifiche.`);
  
  return failed.length === 0;
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);
  const scenarioArg = args.find(a => a.startsWith('--scenario='));
  const scenario = scenarioArg ? scenarioArg.split('=')[1] : null;
  const isCustom = args.includes('--custom');
  
  if (isCustom) {
    const ok = await runCustomTest();
    process.exit(ok ? 0 : 1);
  } else if (scenario) {
    const ok = await runScenario(scenario);
    process.exit(ok ? 0 : 1);
  } else {
    const ok = await runAllScenarios();
    process.exit(ok ? 0 : 1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Errore:', err);
    process.exit(1);
  });
}

module.exports = { runScenario, SCENARIOS, buildTtnPayload };
