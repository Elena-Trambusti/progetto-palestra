/**
 * Golden Run Test - Misuratore dati LORA
 * Verifica l'intera catena di ingestione e analisi.
 */
require('dotenv').config();
const axios = require('axios');

const URL = 'http://localhost:4000/api/ingest';
const SECRET = process.env.INGEST_SECRET || '';

const MOCK_WATER = {
  end_device_ids: { dev_eui: "NODE-WATER-01" },
  uplink_message: {
    f_cnt: Math.floor(Math.random() * 1000),
    decoded_payload: {
      levelPercent: 18.5, // Sotto soglia 20% -> Dovrebbe generare alert
      flowLmin: 5.2,
      battery_level: 95
    }
  },
  received_at: new Date().toISOString()
};

const MOCK_AIR = {
  end_device_ids: { dev_eui: "NODE-ENV-01" },
  uplink_message: {
    f_cnt: Math.floor(Math.random() * 1000),
    decoded_payload: {
      temperatureC: 34.2, // Sopra soglia 32C -> Dovrebbe generare alert
      co2Ppm: 1250,      // Sopra soglia 1000ppm -> Dovrebbe generare alert
      battery_level: 82
    }
  },
  received_at: new Date().toISOString()
};

async function runGoldenRun() {
  console.log('🚀 Avvio Golden Run Test...');

  try {
    console.log('\n1. Test Nodo Vano Idrico (Livello critico)...');
    const resWater = await axios.post(URL, MOCK_WATER, {
      headers: { 'x-ingest-secret': SECRET },
      validateStatus: () => true
    });
    console.log(`   Status: ${resWater.status}`, resWater.data);

    console.log('\n2. Test Nodo Palestra (Ambiente critico)...');
    const resAir = await axios.post(URL, MOCK_AIR, {
      headers: { 'x-ingest-secret': SECRET },
      validateStatus: () => true
    });
    console.log(`   Status: ${resAir.status}`, resAir.data);

    console.log('\n✅ Golden Run completata. Verifica i log del server e Telegram per le notifiche.');
  } catch (err) {
    console.error('❌ Errore durante Golden Run:', err.message);
    if (err.code === 'ECONNREFUSED') {
      console.error('   Assicurati che il server sia avviato (npm run dev) su porta 4000.');
    }
  }
}

runGoldenRun();
