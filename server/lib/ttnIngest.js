/**
 * Integrazione webhook The Things Network (Stack v3):
 * - Estrae dev_eui, payload uplink, metadata radio (RSSI/SNR).
 * - Decodifica binaria in base al tipo sensore registrato nel DB.
 * - Gestione payload vuoto/corrotto e errori DB senza far terminare il processo.
 */
const Joi = require("joi");
const {
  normalizeDevEui,
  findSensorByDevEui,
  insertMeasurement,
  recordSensorReboot,
} = require("./postgresStore");
const { maybeNotifyThresholdAlarm } = require("./telegram");
const { analyzeWaterData } = require("./waterAnalytics");
const { analyzeAirData } = require("./airAnalytics");
const { analyzeMaintenanceTelemetry } = require("./maintenanceAnalytics");
const { notifyInfo } = require("./telegramNotifier");

// CONFIGURAZIONE RESILIENZA
const DEV_EUI_RATE_LIMIT_MAP = new Map();
const MIN_INTERVAL_MS = 5000;
const MAX_CONCURRENT_ANALYSES = 5;
let activeAnalyses = 0;
const analysisQueue = [];

const LAST_FRAME_COUNTERS = new Map();
const AUTHORIZED_DEV_EUIS = ["NODE-WATER-01", "NODE-ENV-01", "GW-LIVORNO-01"];

const ttnIngestSchema = Joi.object({
  end_device_ids: Joi.object({
    dev_eui: Joi.string().min(8).max(32).required(),
    device_id: Joi.string().allow("").optional(),
    application_ids: Joi.object().optional(),
  }).optional(),
  dev_eui: Joi.string().min(8).max(32).optional(), // fallback
  uplink_message: Joi.object({
    decoded_payload: Joi.object({
      temperatureC: Joi.number().min(0).max(60).optional(),
      humidityPercent: Joi.number().min(0).max(100).optional(),
      co2Ppm: Joi.number().integer().min(300).max(5000).optional(),
      vocIndex: Joi.number().integer().min(0).max(500).optional(),
      lux: Joi.number().integer().min(0).max(20000).optional(),
      levelPercent: Joi.number().min(0).max(100).optional(),
      flowLmin: Joi.number().min(0).max(200).optional(),
      battery_level: Joi.number().integer().min(0).max(100).optional(),
    }).required(),
    rx_metadata: Joi.array().items(
      Joi.object({
        rssi: Joi.number().min(-160).max(-30).required(),
        snr: Joi.number().min(-20).max(15).optional(),
        gateway_id: Joi.string().required(),
      })
    ).optional(),
    rssi: Joi.number().min(-160).max(-30).optional(),
    snr: Joi.number().min(-20).max(15).optional(),
    f_cnt: Joi.number().integer().min(0).optional(),
  }).required(),
  received_at: Joi.string().isoDate().required(),
}).required();

/**
 * Estrae i campi principali dal payload TTN validato.
 */

/**
 * Mappatura dinamica sensori - LEGGE DA ENV oppure usa defaults
 * Permette aggiungere nuovi sensori senza modificare il codice
 * 
 * Configurazione via env:
 * SENSOR_MAPPINGS_JSON={"node-custom-01":{"type":"air","fields":["co2Ppm","temperatureC"],"sensorType":"custom-air"}}
 * 
 * Oppure verrà letta da database tabella sensor_mappings (se esiste)
 */
const DEFAULT_SENSOR_MAPPINGS = {
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
 * Carica mappature da ENV o usa defaults
 * @returns {Object} Mappature sensori
 */
function loadSensorMappings() {
  // 1. Prova a leggere da env
  const envMappings = process.env.SENSOR_MAPPINGS_JSON;
  if (envMappings) {
    try {
      const parsed = JSON.parse(envMappings);
      console.log('[ttnIngest] Mappature sensori caricate da SENSOR_MAPPINGS_JSON:', Object.keys(parsed).length, 'sensori');
      return { ...DEFAULT_SENSOR_MAPPINGS, ...parsed };
    } catch (err) {
      console.error('[ttnIngest] Errore parsing SENSOR_MAPPINGS_JSON:', err.message);
    }
  }
  
  // 2. Altrimenti usa defaults
  return DEFAULT_SENSOR_MAPPINGS;
}

// Cache mappature (ricaricate ogni volta per permettere hot-reload in dev)
const SENSOR_MAPPINGS = loadSensorMappings();

/**
 * Estrae i campi specifici per tipo di sensore dal payload
 * Utilizza prima il tipo dal DB, poi la mappatura dinamica e fallback generico
 */
function extractSensorData(deviceId, payload, dbSensor = null) {
  // 1. Priorità massima: usa il tipo configurato nel Database
  if (dbSensor && dbSensor.type) {
    return {
      type: dbSensor.type,
      data: payload,
      sensorType: dbSensor.type
    };
  }

  // 2. Ricarica mappature env/defaults (per hot-reload in dev)
  const mappings = process.env.NODE_ENV === 'development' ? loadSensorMappings() : SENSOR_MAPPINGS;
  const mapping = mappings[deviceId];
  
  // 3. Fallback: Se non c'è mappatura, prova inferenza dal deviceId
  if (!mapping) {
    // Pattern matching per tipo da nome device
    const deviceLower = String(deviceId).toLowerCase();
    if (deviceLower.includes('flow') || deviceLower.includes('water')) {
      return { 
        type: 'water', 
        data: payload, 
        sensorType: 'water-generic' 
      };
    }
    if (deviceLower.includes('air') || deviceLower.includes('env')) {
      return { 
        type: 'air', 
        data: payload, 
        sensorType: 'air-generic' 
      };
    }
    if (deviceLower.includes('temp')) {
      return { 
        type: 'temperature', 
        data: payload, 
        sensorType: 'temp-generic' 
      };
    }
    
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
    decoded.battery_level ?? decoded.batteryPercent ?? decoded.battery ?? decoded.bat ?? decoded.vbat;
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
 * Valida payload TTN usando Joi
 * @param {Object} body - Payload grezzo
 * @returns {{valid: boolean, error?: string, details?: Array}}
 */
function validateTtnPayload(body) {
  const { error, value } = ttnIngestSchema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    return {
      valid: false,
      error: "validation_error",
      details: error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      })),
    };
  }
  return { valid: true, data: value };
}

/**
 * Pipeline completa: valida dev_eui in anagrafica, decodifica, INSERT measurements.
 * Ritorna { ok, status, detail }; errori DB → dbError + logMessage (nessuna eccezione verso Express).
 */
async function ingestTtnWebhook(body) {
  try {
    // Validazione Joi strict
    const validation = validateTtnPayload(body);
    if (!validation.valid) {
      return {
        ok: false,
        status: 400,
        detail: {
          error: "payload_validation_failed",
          message: "Payload non valido",
          validationErrors: validation.details,
        },
      };
    }

    const validatedData = validation.data;
    const { devEui, decoded, buf, rssi, snr, tsRaw, payloadMeta } = extractTtnFields(validatedData);
  if (!devEui) {
    return { ok: false, status: 400, detail: { error: "dev_eui_missing" } };
  }

  // WHITELIST RIGOROSA (Senior Security Engineer Mode)
  if (!AUTHORIZED_DEV_EUIS.includes(devEui)) {
    console.warn(`[SECURITY_ALERT] Tentativo di ingest da devEUI NON autorizzato: ${devEui}`);
    return { 
      ok: false, 
      status: 401, 
      detail: { 
        error: "unauthorized_device", 
        message: "Dispositivo non presente nella whitelist di sicurezza" 
      } 
    };
  }

  // 1. RATE LIMITING PER devEUI (Protegge il server dai nodi "impazziti")
  const lastSeen = DEV_EUI_RATE_LIMIT_MAP.get(devEui) || 0;
  const nowMs = Date.now();
  if (nowMs - lastSeen < MIN_INTERVAL_MS) {
    // Log silenzioso per non intasare Render
    console.debug(`[DEBUG] Rate limit per ${devEui} (${nowMs - lastSeen}ms)`);
    return { 
      ok: false, 
      status: 429, 
      detail: { error: "rate_limit_exceeded", devEui, retryAfter: "5s" } 
    };
  }
  DEV_EUI_RATE_LIMIT_MAP.set(devEui, nowMs);

  // 2. DEDUPLICAZIONE E REBOOT DETECTION
  const fCnt = validatedData.uplink_message?.f_cnt;
  if (fCnt !== undefined) {
    const lastCnt = LAST_FRAME_COUNTERS.get(devEui);
    if (lastCnt !== undefined) {
      // Caso A: Reboot Hardware (Contatore tornato a zero)
      if (fCnt < 5 && lastCnt > 100) {
        console.log(`[REBOOT_DETECTED] Rilevato reboot hardware per nodo: ${devEui}`);
        // Nota: sensor viene recuperato dopo, quindi sposto la registrazione DB
        // sotto la chiamata findSensorByDevEui
        
        void notifyInfo({
          title: "Rilevato Riavvio Hardware",
          message: `Il sensore ha resettato il contatore (da ${lastCnt} a ${fCnt}).\nIl sistema ha ripristinato la sessione automaticamente.`,
          nodeId: devEui
        }).catch(() => {});
      } 
      // Caso B: Duplicato o Fuori Ordine
      else if (fCnt <= lastCnt) {
        console.debug(`[DEBUG] Duplicato scartato per ${devEui}: f_cnt ${fCnt} <= ${lastCnt}`);
        return { 
          ok: false, 
          status: 200, 
          detail: { error: "duplicate_frame", devEui, fCnt, lastCnt } 
        };
      }
    }
    LAST_FRAME_COUNTERS.set(devEui, fCnt);
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

  // Registra reboot se rilevato poco sopra
  const fCntCheck = validatedData.uplink_message?.f_cnt;
  const lastCntCheck = LAST_FRAME_COUNTERS.get(devEui);
  if (fCntCheck < 5 && lastCntCheck === fCntCheck) { // Abbiamo appena aggiornato Map con 0/1/2...
    // Se era un reboot, l'abbiamo rilevato sopra. 
    // Per semplicità, se fCnt è molto basso, registriamo l'evento nel DB
    void recordSensorReboot(sensor.id).catch(e => console.error("[DB_REBOOT_FAIL]", e));
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

  // Estrai dati specifici per tipo di sensore (usando il tipo dal DB)
  const sensorInfo = extractSensorData(devEui, decoded, sensor);

  const measurementData = {
    sensorId: sensor.id,
    value: Number(value),
    sensorType: sensorInfo.sensorType || sensor.type,
    rssi: radio.rssi,
    snr: radio.snr,
    battery,
    batteryLevel: battery, // Nuovo schema telemetria
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

  // 3. ANALISI CON CONTROLLO CONCORRENZA (Semaphore)
  // Protegge il pool di PostgreSQL limitando le analisi parallele a 5
  const runAnalysis = async () => {
    try {
      if (sensorInfo.type === 'water') {
        await analyzeWaterPacket(sensor, devEui, decoded, tsUtc);
      }
      if (sensorInfo.type === 'air') {
        await analyzeAirPacket(sensor, devEui, sensorInfo.data, tsUtc);
      }
      await analyzeMaintenanceTelemetry({
        sensorId: sensor.id,
        devEui,
        sensorName: sensor.name,
        location: sensor.location,
        batteryLevel: battery,
        rssi: radio.rssi,
        timestamp: tsUtc
      });
    } catch (err) {
      console.error(`[analysisQueue] Errore durante analisi ${devEui}:`, err);
    } finally {
      activeAnalyses--;
      processNextAnalysis();
    }
  };

  const processNextAnalysis = () => {
    if (analysisQueue.length > 0 && activeAnalyses < MAX_CONCURRENT_ANALYSES) {
      const nextTask = analysisQueue.shift();
      activeAnalyses++;
      nextTask();
    }
  };

  // Accoda l'analisi e avvia la gestione della coda
  analysisQueue.push(runAnalysis);
  processNextAnalysis();

  return {
    ok: true,
    status: 200,
    detail: {
      ok: true,
      sensorId: sensor.id,
      devEui,
      value: numericValue,
      timestampUtc: tsUtc.toISOString(),
    },
  };

  } catch (err) {
    console.error(`[AUDIT_FAIL] Eccezione non gestita durante ingest: ${err.message}`, err.stack);
    return {
      ok: false,
      status: 500,
      detail: { error: "internal_server_error", message: "Errore imprevisto durante l'elaborazione del segnale." }
    };
  }
}

/**
 * Analizza pacchetto dati acqua con "Misuratore dati LORA"
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
 * Analizza pacchetto dati aria con "Misuratore dati LORA Aria"
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
      timestamp,
      maxThreshold: sensor.max_threshold || null
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
  validateTtnPayload,
  ttnIngestSchema,
};
