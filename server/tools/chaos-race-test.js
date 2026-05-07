/**
 * Stress Test & Race Condition Verification
 * Simula invii simultanei dello stesso pacchetto LoRa per verificare
 * che la deduplicazione in-memory e su Database (UNIQUE index) funzioni correttamente.
 */
require('dotenv').config();
const axios = require('axios');

const URL = 'http://localhost:4000/api/ingest';
const SECRET = process.env.INGEST_SECRET || '';

const MOCK_UPLINK = (f_cnt) => ({
  end_device_ids: {
    dev_eui: "NODE-WATER-01",
    application_ids: { application_id: "palestra-app" }
  },
  uplink_message: {
    f_cnt: f_cnt,
    frm_payload: "AQID", // Dummy payload
    decoded_payload: {
      levelPercent: 75.5,
      battery_level: 88
    },
    rx_metadata: [{ rssi: -105, snr: 7.2, gateway_id: "gw-test" }]
  },
  received_at: new Date().toISOString()
});

async function runRaceTest() {
  console.log('--- START CHAOS RACE TEST ---');
  console.log('Simulazione di 10 pacchetti identici inviati SIMULTANEAMENTE...');

  const f_cnt = Math.floor(Math.random() * 10000) + 1000;
  const payload = MOCK_UPLINK(f_cnt);
  
  const requests = Array(10).fill(0).map((_, i) => {
    return axios.post(URL, payload, {
      headers: { 'x-ingest-secret': SECRET },
      validateStatus: () => true
    }).then(res => ({
      index: i,
      status: res.status,
      data: res.data
    }));
  });

  const results = await Promise.all(requests);

  const accepted = results.filter(r => r.status === 200);
  const rejected = results.filter(r => r.status === 429 || (r.status === 200 && r.data.error === 'duplicate_frame'));

  console.log(`\nRisultati:`);
  console.log(`- Totale richieste: ${results.length}`);
  console.log(`- Accettate (200 OK): ${accepted.length}`);
  console.log(`- Rifiutate (Rate Limit / Duplicate): ${rejected.length}`);

  if (accepted.length > 1) {
    console.error('❌ FALLITO: Più di un pacchetto identico è stato accettato! Possibile Race Condition.');
  } else if (accepted.length === 1) {
    console.log('✅ SUCCESSO: Solo 1 pacchetto è stato accettato, gli altri scartati correttamente.');
  } else {
    console.warn('⚠️ ATTENZIONE: Nessun pacchetto accettato (forse rate limit globale o errore config).');
  }

  // Test Reboot Detection
  console.log('\nSimulazione Reboot (f_cnt reset)...');
  const rebootPayload = MOCK_UPLINK(1); // Reset a 1
  const rebootRes = await axios.post(URL, rebootPayload, {
    headers: { 'x-ingest-secret': SECRET },
    validateStatus: () => true
  });
  
  if (rebootRes.status === 200) {
    console.log('✅ Reboot accettato correttamente.');
  } else {
    console.error(`❌ Reboot fallito: status ${rebootRes.status}`, rebootRes.data);
  }
}

runRaceTest().catch(console.error);
