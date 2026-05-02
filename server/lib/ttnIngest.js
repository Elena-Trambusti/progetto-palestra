/**
 * Integrazione webhook The Things Network (Stack v3):
 * - Estrae dev_eui, payload uplink, metadata radio (RSSI/SNR).
 * - Decodifica binaria in base al tipo sensore registrato nel DB.
 * - Gestione payload vuoto/corrotto e errori DB senza far terminare il processo.
 */
const {
  normalizeDevEui,
  findSensorByDevEui,
  insertMeasurement,
} = require("./postgresStore");
const { maybeNotifyThresholdAlarm } = require("./telegram");
const { analyzeWaterData } = require("./waterAnalytics");
const { analyzeAirData } = require("./airAnalytics");

/**
 * Mappatura dinamica sensori per distinguere tipi e campi
 * Estensibile per futuri sensori (vibrazione, temperatura, etc.)
 */
const SENSOR_MAPPINGS = {
  // Sensori Acqua
  'node-flow-01': {
    type: 'water',
    fields: ['flowLmin', 'levelPercent'],
    sensorType: 'water-flow'
  },
  'node-water-01': {
    type: 'water', 
    fields: ['levelPercent', 'temperatureC'],
    sensorType: 'water-level'
  },
  
  // Sensori Aria
  'node-air-01': {
    type: 'air',
    fields: ['co2Ppm', 'vocIndex', 'lux'],
    sensorType: 'air-quality'
  },
  
  // Sensori Temperatura (esempio futuro)
  'node-temp-01': {
    type: 'temperature',
    fields: ['temperatureC', 'humidityPercent'],
    sensorType: 'temperature'
  }
};

/**
 * Estrae i campi specifici per tipo di sensore dal payload
 */
function extractSensorData(deviceId, payload) {
  const mapping = SENSOR_MAPPINGS[deviceId];
  if (!mapping) {
    return { type: 'unknown', data: payload, sensorType: 'unknown' };
  }
  
  const data = {};
  mapping.fields.forEach(field => {
    if (payload[field] !== undefined) {
      data[field] = payload[field];
    }
  });
  
  return {
    type: mapping.type,
    data: data,
    sensorType: mapping.sensorType
  };
}

/**
 * Converte il timestamp uplink in un istante UTC affidabile.
 * Se la stringa ISO non ha fuso orario (es. senza "Z" né "+01:00"), si assume UTC
 * per evitare che il fuso del server Render distorca l'orario rispetto alla palestra.
 */
function parseIngestTimestampUtc(tsRaw) {
  if (tsRaw == null || tsRaw === "") return new Date();
  if (tsRaw instanceof Date && !Number.isNaN(tsRaw.getTime())) return tsRaw;
  let s = String(tsRaw).trim();
  if (!s) return new Date();
  const hasZone =
    /[zZ]$/.test(s) ||
    /[+-]\d{2}:\d{2}$/.test(s) ||
    /[+-]\d{2}\d{2}$/.test(s) ||
    /[+-]\d{2}:\d{2}:\d{2}$/.test(s);
  if (!hasZone) {
    s = s.replace(" ", "T");
    if (!/[zZ]$/.test(s)) s = `${s}Z`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Decodifica Base64 del campo `frm_payload` / `payload_raw` TTN.
 * Controlli preventivi per payload vuoto o stringa non decodificabile senza eccezioni non gestite.
 */
function frmPayloadToBuffer(frmPayloadB64) {
  if (frmPayloadB64 == null) return { ok: false, reason: "payload_missing", buffer: null };
  if (typeof frmPayloadB64 !== "string") {
    return { ok: false, reason: "payload_not_string", buffer: null };
  }
  const trimmed = frmPayloadB64.replace(/\s+/g, "");
  if (!trimmed.length) {
    return { ok: false, reason: "payload_empty", buffer: null };
  }
  const b64 = /^[A-Za-z0-9+/]+=*$/.test(trimmed);
  if (!b64) {
    return { ok: false, reason: "payload_corrupt_base64_alphabet", buffer: null };
  }
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (!buf.length && trimmed.replace(/=/g, "").length > 0) {
      return { ok: false, reason: "payload_corrupt_decode_empty", buffer: null };
    }
    return { ok: true, reason: null, buffer: buf };
  } catch {
    return { ok: false, reason: "payload_corrupt_decode_exception", buffer: null };
  }
}

/**
 * Normalizza la stringa `type` dell'anagrafica in una chiave stabile per il decoder.
 * Estendi questa funzione se aggiungi nuove voci nel form Admin.
 */
function binaryDecodeCategory(sensorType) {
  const t = String(sensorType || "").toLowerCase();
  if (t.includes("co2")) return "co2";
  if (t.includes("livello") || t.includes("level")) return "livello";
  if (t.includes("umid") || t.includes("humid") || t.includes("rh")) return "umidita";
  if (t.includes("voc") || t.includes("iaq") || t.includes("qualità") || t.includes("qualita"))
    return "voc";
  if (t.includes("lux") || t.includes("luce")) return "luce";
  if (t.includes("fluss") || t.includes("flow")) return "flusso";
  if (t.includes("temp")) return "temperatura";
  return "temperatura";
}

/**
 * Decodifica i byte grezzi del payload uplink in valore di processo (+ batteria opzionale).
 * Lettura buffer protetta da RangeError se il payload è troppo corto per il tipo.
 */
function decodeBinaryForSensorType(buf, sensorType) {
  if (!buf || buf.length < 2) return { value: null, battery: null };

  const category = binaryDecodeCategory(sensorType);
  let value = null;
  let battery = null;

  try {
    switch (category) {
      case "co2": {
        value = buf.readUInt16BE(0);
        break;
      }
      case "livello": {
        value = Math.min(100, Math.max(0, buf.readUInt16BE(0) / 100));
        break;
      }
      case "umidita": {
        value = buf.readUInt16BE(0) / 100;
        break;
      }
      case "voc": {
        value = buf.readUInt16BE(0);
        break;
      }
      case "luce": {
        value = buf.readUInt16BE(0);
        break;
      }
      case "flusso": {
        value = buf.readInt16BE(0) / 100;
        break;
      }
      case "temperatura":
      default: {
        value = buf.readInt16BE(0) / 100;
        break;
      }
    }

    if (buf.length >= 3) {
      battery = Math.min(100, Math.max(0, buf.readUInt8(2)));
    }
  } catch {
    return { value: null, battery: null, decodeRangeError: true };
  }

  return { value, battery, decodeRangeError: false };
}

/**
 * Se il device ha un decoder TTN lato applicazione, i campi compaiono in `decoded_payload`.
 */
function pickDecodedNumeric(decoded) {
  if (!decoded || typeof decoded !== "object") return null;
  const keys = [
    "temperature",
    "temp",
    "temperatureC",
    "co2",
    "humidity",
    "rh",
    "level",
    "levelPercent",
    "lux",
    "lightLux",
    "voc",
    "vocIndex",
    "iaq",
    "flow",
    "flowLmin",
    "value",
  ];
  for (const k of keys) {
    if (decoded[k] != null && Number.isFinite(Number(decoded[k]))) {
      return Number(decoded[k]);
    }
  }
  return null;
}

function pickBatteryDecoded(decoded) {
  if (!decoded || typeof decoded !== "object") return null;
  const v =
    decoded.batteryPercent ?? decoded.battery ?? decoded.bat ?? decoded.vbat;
  if (v == null) return null;
  if (!Number.isFinite(Number(v))) return null;
  return Math.min(100, Math.max(0, Number(v)));
}

/**
 * Estrae campi standard dal JSON TTN (varianti comuni di naming).
 */
function extractTtnFields(body) {
  const endIds = body?.end_device_ids || {};
  const devRaw =
    endIds.dev_eui ||
    endIds.dev_eui_ng ||
    body?.dev_eui ||
    body?.end_device_eui ||
    "";
  const devEui = normalizeDevEui(devRaw);

  const msg = body?.uplink_message || body?.uplink || body || {};
  const decoded = msg.decoded_payload || msg.decoded || null;
  const rawB64 = msg.frm_payload ?? msg.payload_raw ?? msg.payload ?? null;
  const payloadMeta = frmPayloadToBuffer(rawB64);
  const buf = payloadMeta.ok ? payloadMeta.buffer : null;

  const rxList = Array.isArray(msg.rx_metadata) ? msg.rx_metadata : [];
  const rx0 = rxList[0] || {};
  const rssi =
    rx0.rssi ??
    msg.rssi ??
    (Array.isArray(msg.gateway_metadata) ? msg.gateway_metadata[0]?.rssi : null);
  const snr = rx0.snr ?? msg.snr ?? null;

  const tsRaw =
    msg.received_at ||
    msg.time ||
    body?.received_at ||
    body?.ingest_time ||
    null;

  return { devEui, msg, decoded, buf, rssi, snr, tsRaw, payloadMeta };
}

/**
 * Normalizza RSSI/SNR in numeri utilizzabili dal DB.
 */
function sanitizeRadio(rssi, snr) {
  return {
    rssi:
      rssi != null && Number.isFinite(Number(rssi))
        ? Math.min(-1, Math.max(-160, Number(rssi)))
        : null,
    snr:
      snr != null && Number.isFinite(Number(snr))
        ? Math.min(30, Math.max(-30, Number(snr)))
        : null,
  };
}

/**
 * Errori PostgreSQL / rete tipici di indisponibilità temporanea (nessun crash del processo).
 */
function isDatabaseTransientError(err) {
  if (!err) return false;
  const code = String(err.code || "");
  if (/^08/.test(code)) return true;
  if (code === "57P01" || code === "57P02" || code === "57P03") return true;
  const errno = err.errno || err.code;
  if (errno === "ECONNREFUSED" || errno === "ETIMEDOUT" || errno === "ENOTFOUND") return true;
  const msg = String(err.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("econnrefused") || msg.includes("connection terminated")) {
    return true;
  }
  return false;
}

function databaseFailureResponse(err, phase) {
  const transient = isDatabaseTransientError(err);
  const status = transient ? 503 : 500;
  const msg = err && err.message ? err.message : String(err);
  return {
    ok: false,
    status,
    dbError: true,
    detail: {
      error: transient ? "database_unavailable" : "database_error",
      hint: transient
        ? "Database momentaneamente irraggiungibile: la misura non è stata salvata. Riprova quando il servizio è di nuovo disponibile."
        : "Errore durante l'accesso al database; la misura non è stata salvata.",
    },
    logMessage: `[ingest:${phase}] ${msg}`,
    logExtra: {
      pgCode: err && err.code,
      errno: err && err.errno,
    },
  };
}

/**
 * Pipeline completa: valida dev_eui in anagrafica, decodifica, INSERT measurements.
 * Ritorna { ok, status, detail }; errori DB → dbError + logMessage (nessuna eccezione verso Express).
 */
async function ingestTtnWebhook(body) {
  const { devEui, decoded, buf, rssi, snr, tsRaw, payloadMeta } = extractTtnFields(body);
  if (!devEui) {
    return { ok: false, status: 400, detail: { error: "dev_eui_missing" } };
  }

  let sensor;
  try {
    sensor = await findSensorByDevEui(devEui);
  } catch (err) {
    return databaseFailureResponse(err, "findSensorByDevEui");
  }

  if (!sensor) {
    return {
      ok: false,
      status: 403,
      detail: { error: "unauthorized_device", devEui },
      log: "Dispositivo non autorizzato",
    };
  }

  let value = pickDecodedNumeric(decoded);
  let battery = pickBatteryDecoded(decoded);

  const hasDecodedValue = value != null && Number.isFinite(Number(value));
  const hasBinary = buf != null && buf.length > 0;

  if (!hasDecodedValue) {
    if (!payloadMeta.ok) {
      return {
        ok: false,
        status: 400,
        detail: {
          error: "payload_raw_invalid",
          reason: payloadMeta.reason || "payload_invalid",
          devEui,
          hint:
            "Payload grezzo assente, vuoto o non decodificabile in Base64. Verifica frm_payload / payload_raw sul webhook TTN.",
        },
      };
    }
    if (!hasBinary) {
      return {
        ok: false,
        status: 400,
        detail: {
          error: "payload_raw_empty",
          devEui,
          hint:
            "Nessun byte nel payload dopo la decodifica Base64 e nessun decoded_payload numerico. Controlla il device o il formatter TTN.",
        },
      };
    }
    const dec = decodeBinaryForSensorType(buf, sensor.type);
    if (dec.decodeRangeError) {
      return {
        ok: false,
        status: 400,
        detail: {
          error: "decode_binary_range",
          devEui,
          hint:
            "Payload binario troppo corto o non allineato al decoder per questo tipo di sensore (lettura oltre i byte disponibili).",
        },
      };
    }
    value = dec.value;
    if (battery == null && dec.battery != null) battery = dec.battery;
  }

  if (value == null || !Number.isFinite(Number(value))) {
    return {
      ok: false,
      status: 400,
      detail: {
        error: "decode_failed",
        devEui,
        hint:
          "Impossibile ricavare un valore numerico da decoded_payload né dal payload binario.",
      },
    };
  }

  const radio = sanitizeRadio(rssi, snr);
  const tsUtc = parseIngestTimestampUtc(tsRaw);

  // Estrai dati specifici per tipo di sensore
  const sensorInfo = extractSensorData(devEui, decoded);
  
  // Prepara campi specifici per insertMeasurement
  const measurementData = {
    sensorId: sensor.id,
    value: Number(value),
    sensorType: sensorInfo.sensorType,
    rssi: radio.rssi,
    snr: radio.snr,
    battery,
    timestamp: tsUtc,
  };
  
  // Aggiungi campi specifici per sensori aria
  if (sensorInfo.type === 'air') {
    measurementData.co2 = sensorInfo.data.co2Ppm || null;
    measurementData.voc = sensorInfo.data.vocIndex || null;
    measurementData.lux = sensorInfo.data.lux || null;
  }

  try {
    await insertMeasurement(measurementData);
  } catch (err) {
    return databaseFailureResponse(err, "insertMeasurement");
  }

  const numericValue = Number(value);
  void maybeNotifyThresholdAlarm(sensor, numericValue).catch((err) => {
    console.warn("[telegram]", err && err.message ? err.message : err);
  });

  // "Sesto Senso" - Analisi intelligente per nodi acqua
  if (sensorInfo.type === 'water') {
    void analyzeWaterPacket(sensor, devEui, decoded, tsUtc).catch((err) => {
      console.warn("[waterAnalytics]", err && err.message ? err.message : err);
    });
  }
  
  // "Sesto Senso Aria" - Analisi intelligente per nodi aria
  if (sensorInfo.type === 'air') {
    void analyzeAirPacket(sensor, devEui, sensorInfo.data, tsUtc).catch((err) => {
      console.warn("[airAnalytics]", err && err.message ? err.message : err);
    });
  }

  return {
    ok: true,
    status: 200,
    detail: {
      ok: true,
      sensorId: sensor.id,
      devEui,
      value: Number(value),
      timestampUtc: tsUtc.toISOString(),
    },
  };
}

/**
 * Analizza pacchetto dati acqua con "Sesto Senso"
 */
async function analyzeWaterPacket(sensor, devEui, decoded, timestamp) {
  try {
    // Estrai dati dal decoded payload
    const flowLmin = decoded?.flowLmin || decoded?.flow || null;
    const levelPercent = decoded?.levelPercent || decoded?.level || null;
    
    if (flowLmin === null && levelPercent === null) {
      return; // Nessun dato acqua rilevante
    }

    console.log(`[waterAnalytics] Analisi pacchetto acqua: ${devEui}`, {
      flowLmin,
      levelPercent,
      timestamp: timestamp.toISOString()
    });

    // Esegui analisi intelligente
    const analysis = await analyzeWaterData({
      nodeId: devEui,
      flowLmin: Number(flowLmin) || 0,
      levelPercent: Number(levelPercent) || null,
      timestamp
    });

    if (analysis.alerts.length > 0) {
      console.log(`[waterAnalytics] Alert generati per ${devEui}:`, analysis.alerts.map(a => a.type));
    }

  } catch (error) {
    console.error(`[waterAnalytics] Errore analisi pacchetto ${devEui}:`, error);
  }
}

/**
 * Analizza pacchetto dati aria con "Sesto Senso Aria"
 */
async function analyzeAirPacket(sensor, devEui, airData, timestamp) {
  try {
    console.log(`[airAnalytics] Analisi pacchetto aria da ${devEui}:`, airData);

    // Esegui analisi intelligente aria
    const analysis = await analyzeAirData({
      nodeId: devEui,
      co2: airData.co2Ppm || null,
      voc: airData.vocIndex || null,
      lux: airData.lux || null,
      timestamp
    });

    if (analysis.alerts.length > 0) {
      console.log(`[airAnalytics] Alert generati per ${devEui}:`, analysis.alerts.map(a => a.title));
    }

  } catch (error) {
    console.error(`[airAnalytics] Errore analisi pacchetto ${devEui}:`, error);
  }
}

module.exports = {
  extractTtnFields,
  binaryDecodeCategory,
  decodeBinaryForSensorType,
  ingestTtnWebhook,
  frmPayloadToBuffer,
  parseIngestTimestampUtc,
  analyzeWaterPacket,
};
