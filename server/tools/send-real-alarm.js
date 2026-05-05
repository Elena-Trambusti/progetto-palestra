const https = require('https');

const data = JSON.stringify({
  end_device_ids: { dev_eui: "node-env-01" },
  uplink_message: {
    f_cnt: 126,
    decoded_payload: { co2Ppm: 1850, temperatureC: 22.5 },
    rx_metadata: [{ rssi: -90, snr: 7.0, gateway_id: "test-gw" }],
    received_at: "2026-05-05T11:20:00Z"
  },
  received_at: "2026-05-05T11:20:00Z"
});

const options = {
  hostname: 'backend-palestra.onrender.com',
  port: 443,
  path: '/api/ingest',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'x-ingest-secret': process.env.INGEST_SECRET || ''
  }
};

console.log("Inviando allarme critico reale a Render...");
const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.write(data);
req.end();
