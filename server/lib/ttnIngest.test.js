const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTtnFields,
  frmPayloadToBuffer,
  parseIngestTimestampUtc,
  binaryDecodeCategory,
  decodeBinaryForSensorType,
} = require("./ttnIngest");

test("extractTtnFields: TTN Stack v3 uplink con decoded_payload", () => {
  const body = {
    end_device_ids: { dev_eui: "0123456789ABCDEF" },
    received_at: "2024-06-01T10:00:00.000Z",
    uplink_message: {
      frm_payload: "",
      decoded_payload: { temperature: 22.5 },
      rx_metadata: [{ rssi: -105, snr: 6.2 }],
    },
  };
  const f = extractTtnFields(body);
  assert.equal(f.devEui, "0123456789ABCDEF");
  assert.equal(f.decoded.temperature, 22.5);
  assert.equal(f.rssi, -105);
  assert.equal(f.snr, 6.2);
});

test("extractTtnFields: frm_payload base64 temperatura (2 byte)", () => {
  const buf = Buffer.alloc(2);
  buf.writeInt16BE(2150, 0);
  const body = {
    end_device_ids: { dev_eui: "A0B1C2D3E4F56789" },
    uplink_message: {
      frm_payload: buf.toString("base64"),
      rx_metadata: [],
    },
  };
  const f = extractTtnFields(body);
  assert.equal(f.devEui, "A0B1C2D3E4F56789");
  assert.ok(f.payloadMeta.ok);
  assert.equal(f.buf.length, 2);
});

test("frmPayloadToBuffer: rifiuta base64 invalido", () => {
  const r = frmPayloadToBuffer("@@@");
  assert.equal(r.ok, false);
  assert.ok(r.reason);
});

test("parseIngestTimestampUtc: stringa senza fuso → UTC", () => {
  const d = parseIngestTimestampUtc("2024-01-15 14:30:00");
  assert.ok(d instanceof Date);
  assert.equal(Number.isNaN(d.getTime()), false);
  assert.match(d.toISOString(), /^2024-01-15T14:30:00\.000Z$/);
});

test("binaryDecodeCategory: mappa tipi noti", () => {
  assert.equal(binaryDecodeCategory("Sensore temperatura"), "temperatura");
  assert.equal(binaryDecodeCategory("Livello serbatoio"), "livello");
  assert.equal(binaryDecodeCategory("CO2 indoor"), "co2");
});

test("decodeBinaryForSensorType: temperatura da int16 BE", () => {
  const buf = Buffer.alloc(2);
  buf.writeInt16BE(2150, 0);
  const r = decodeBinaryForSensorType(buf, "temperatura");
  assert.equal(r.value, 21.5);
});

test("decodeBinaryForSensorType: livello percentuale", () => {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(6550, 0);
  const r = decodeBinaryForSensorType(buf, "livello acqua");
  assert.equal(r.value, 65.5);
});
