/**
 * Test decoder MKR WAN 1310 e validazione webhook TTN.
 */
const {
  decodeMkrPayload,
  extractTtnFields,
  validateTtnPayload,
  hasMeaningfulDecodedPayload,
  isAirSensorType,
} = require("../lib/ttnIngest");

function buildMkrCo2Payload({ co2 = 720, tempC = 24.16, rh = 54, batt = 90 } = {}) {
  const buf = Buffer.alloc(7);
  buf.writeUInt16BE(co2, 0);
  buf.writeInt16BE(Math.round(tempC * 100), 2);
  buf.writeUInt16BE(Math.round(rh * 100), 4);
  buf.writeUInt8(batt, 6);
  return buf;
}

describe("decodeMkrPayload", () => {
  test("porta 1: decodifica CO2, temperatura, umidità e batteria", () => {
    const buf = buildMkrCo2Payload({ co2: 720, tempC: 24.16, rh: 54, batt: 90 });
    const decoded = decodeMkrPayload(buf, 1);
    expect(decoded).toMatchObject({
      co2Ppm: 720,
      temperatureC: 24.16,
      humidityPercent: 54,
      battery_level: 90,
      sensorFault: null,
      _mkrDecoded: true,
      _port: 1,
    });
  });

  test("porta 1: temperatura negativa sotto zero", () => {
    const buf = buildMkrCo2Payload({ co2: 450, tempC: -5.5, rh: 40, batt: 80 });
    const decoded = decodeMkrPayload(buf, 1);
    expect(decoded.temperatureC).toBeCloseTo(-5.5, 2);
  });

  test("porta 1: marker 0xFFFF → Errore Sensore", () => {
    const buf = buildMkrCo2Payload({ co2: 0xffff, tempC: 0, rh: 0, batt: 75 });
    const decoded = decodeMkrPayload(buf, 1);
    expect(decoded.co2Ppm).toBeNull();
    expect(decoded.sensorFault).toBe("Errore Sensore");
  });

  test("porta 2: decodifica nodo idrico", () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt16BE(500, 0); // 5.00 L/min
    buf.writeUInt16BE(7500, 2); // 75.00 %
    buf.writeInt16BE(1920, 4); // 19.20 °C
    buf.writeUInt8(95, 6);
    buf.writeUInt8(0x01, 7);
    const decoded = decodeMkrPayload(buf, 2);
    expect(decoded).toMatchObject({
      flowLmin: 5,
      levelPercent: 75,
      temperatureC: 19.2,
      battery_level: 95,
      wakeOnFlow: true,
      _port: 2,
    });
  });
});

describe("extractTtnFields MKR", () => {
  test("decodifica da frm_payload senza decoded_payload significativo", () => {
    const buf = buildMkrCo2Payload({ co2: 800, tempC: 22.5, rh: 48, batt: 88 });
    const body = {
      end_device_ids: { dev_eui: "AABBCCDDEEFF0011" },
      received_at: "2026-05-03T12:00:00Z",
      uplink_message: {
        f_port: 1,
        frm_payload: buf.toString("base64"),
        decoded_payload: {},
        rx_metadata: [{ rssi: -95, snr: 7, gateway_id: "gw-01" }],
      },
    };
    const validated = validateTtnPayload(body);
    expect(validated.valid).toBe(true);

    const fields = extractTtnFields(validated.data);
    expect(fields.decoded._mkrDecoded).toBe(true);
    expect(fields.decoded.co2Ppm).toBe(800);
    expect(fields.decoded.temperatureC).toBeCloseTo(22.5, 1);
    expect(fields.decoded.humidityPercent).toBe(48);
  });
});

describe("helpers ttnIngest", () => {
  test("hasMeaningfulDecodedPayload: oggetto vuoto → false", () => {
    expect(hasMeaningfulDecodedPayload({})).toBe(false);
  });

  test("hasMeaningfulDecodedPayload: campo noto → true", () => {
    expect(hasMeaningfulDecodedPayload({ temperatureC: 20 })).toBe(true);
  });

  test("isAirSensorType riconosce Ambiente e air", () => {
    expect(isAirSensorType("air")).toBe(true);
    expect(isAirSensorType("Ambiente")).toBe(true);
    expect(isAirSensorType("CO2 indoor")).toBe(true);
    expect(isAirSensorType("water")).toBe(false);
  });
});

describe("validateTtnPayload MKR fields", () => {
  test("accetta temperatura negativa", () => {
    const payload = {
      end_device_ids: { dev_eui: "AABBCCDDEEFF0011" },
      uplink_message: {
        decoded_payload: { temperatureC: -3.5 },
      },
      received_at: "2026-05-03T12:00:00Z",
    };
    expect(validateTtnPayload(payload).valid).toBe(true);
  });

  test("accetta webhook solo con frm_payload e f_port", () => {
    const buf = buildMkrCo2Payload();
    const payload = {
      end_device_ids: { dev_eui: "AABBCCDDEEFF0011" },
      uplink_message: {
        f_port: 1,
        frm_payload: buf.toString("base64"),
      },
      received_at: "2026-05-03T12:00:00Z",
    };
    const result = validateTtnPayload(payload);
    expect(result.valid).toBe(true);
    expect(result.data.uplink_message.frm_payload).toBeDefined();
    expect(result.data.uplink_message.f_port).toBe(1);
  });
});
