/**
 * Integrazione webhook The Things Network (Stack v3):
 * - Estrae dev_eui, payload uplink, metadata radio (RSSI/SNR).
 * - Decodifica binaria in base al tipo sensore registrato nel DB.
 * - Gestione payload vuoto/corrotto e errori DB senza far terminare il processo.
 */
const Joi = require("joi");
const pgStore = require("./postgresStore");
const {
  normalizeDevEui,
  findSensorByDevEui,
  insertMeasurement,
  recordSensorReboot,
  insertSensor,
  fetchTopology,
} = pgStore;
const { maybeNotifyThresholdAlarm } = require("./telegram");
const { updateTopology } = require("./zonesData");
const { analyzeWaterData } = require("./waterAnalytics");
const { analyzeAirData } = require("./airAnalytics");
const { analyzeMaintenanceTelemetry } = require("./maintenanceAnalytics");
const { notifyInfo } = require("./telegramNotifier");

// COSTANTI DI SISTEMA (Anti-Magic Numbers)
const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_RATE_LIMIT = 429;
const STATUS_SERVER_ERROR = 500;

const MIN_INTERVAL_MS = Number(process.env.INGEST_MIN_INTERVAL_MS) || 5000;
const MAX_ANALYSIS_QUEUE_SIZE = Number(process.env.INGEST_MAX_QUEUE_SIZE) || 100;
const MAX_CONCURRENT_ANALYSES = Number(process.env.INGEST_MAX_CONCURRENT) || 5;

// STATO IN-MEMORY (Resilienza e Performance)
const DEV_EUI_RATE_LIMIT_MAP = new Map();
const LAST_FRAME_COUNTERS = new Map();
const analysisQueue = [];
let activeAnalyses = 0;

const AUTHORIZED_DEV_EUIS = (process.env.AUTHORIZED_DEV_EUIS || "").split(",").map(id => id.trim()).filter(Boolean);

function publicErrorLog() {
  console.error("Error");
}

const ttnIngestSchema = Joi.object({
  end_device_ids: Joi.object({
    dev_eui: Joi.string().min(8).max(32).required(),
    device_id: Joi.string().allow("").optional(),
    application_ids: Joi.object().optional(),
  }).optional(),
  dev_eui: Joi.string().min(8).max(32).optional(), // fallback
  uplink_message: Joi.object({
    decoded_payload: Joi.object({
      temperatureC: Joi.number().min(-45).max(60).optional(),
      humidityPercent: Joi.number().min(0).max(100).optional(),
      // 65535 (0xFFFF) = marker guasto sensore dal firmware MKR.
      co2Ppm: Joi.number().integer().min(300).max(65535).optional(),
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
    } catch {
      publicErrorLog();
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
 * ============================================================
 * DECODER NATIVO ARDUINO MKR WAN 1310
 * ============================================================
 * Decodifica i payload HEX compressi prodotti dai firmware
 * mkr_node_co2_env.ino (7 byte, porta 1) e
 * mkr_node_water_flow.ino (8 byte, porta 2).
 *
 * FORMATO NODO CO2/AMBIENTE (7 byte, LoRa port 1):
 *   Byte 0-1 : CO2 ppm       (uint16 BE)
 *   Byte 2-3 : Temp × 100   (int16  BE)
 *   Byte 4-5 : RH   × 100   (uint16 BE)
 *   Byte 6   : Batteria %   (uint8)
 *
 * FORMATO NODO IDRICO (8 byte, LoRa port 2):
 *   Byte 0-1 : Flusso × 100 L/min  (uint16 BE)
 *   Byte 2-3 : Livello × 100 %     (uint16 BE)
 *   Byte 4-5 : Temp × 100          (int16  BE)
 *   Byte 6   : Batteria %          (uint8)
 *   Byte 7   : Flags (bit0=wakeOnFlow) (uint8)
 *
 * @param {Buffer} buf   - Buffer raw del payload (da frm_payload base64)
 * @param {number} port  - Porta LoRaWAN (f_port) del pacchetto
 * @returns {Object|null} decoded_payload compatibile con il resto della pipeline
 */
function decodeMkrPayload(buf, port) {
  if (!buf || buf.length === 0) return null;

  try {
    // ---- Porta 1: Nodo CO2 / Ambiente (SCD41) – 7 byte ----
    if (port === 1 && buf.length >= 7) {
      const co2Raw          = buf.readUInt16BE(0);
      const temperatureC    = buf.readInt16BE(2)  / 100.0;
      const humidityPercent = buf.readUInt16BE(4) / 100.0;
      const battery_level   = buf.readUInt8(6);
      const isCo2SensorFault = co2Raw === 0xFFFF;
      const co2Ppm = isCo2SensorFault ? null : co2Raw;

      // Sanity check valori fisicamente plausibili
      if (!isCo2SensorFault && (co2Ppm < 300 || co2Ppm > 5000)) {
        publicErrorLog();
        return null;
      }

      if (isCo2SensorFault) {
        console.log(`[decodeMkrPayload] Porta 1 CO2=Errore Sensore (0xFFFF) T=${temperatureC}°C RH=${humidityPercent}% Batt=${battery_level}%`);
      } else {
        console.log(`[decodeMkrPayload] Porta 1 CO2=${co2Ppm}ppm T=${temperatureC}°C RH=${humidityPercent}% Batt=${battery_level}%`);
      }
      return {
        co2Ppm,
        temperatureC,
        humidityPercent,
        battery_level,
        sensorFault: isCo2SensorFault ? "Errore Sensore" : null,
        _mkrDecoded: true,
        _port: 1,
      };
    }

    // ---- Porta 2: Nodo Idrico (YF-S201 + HC-SR04) – 8 byte ----
    if (port === 2 && buf.length >= 8) {
      const flowLmin      = buf.readUInt16BE(0) / 100.0;
      const levelPercent  = buf.readUInt16BE(2) / 100.0;
      const temperatureC  = buf.readInt16BE(4)  / 100.0;
      const battery_level = buf.readUInt8(6);
      const flags         = buf.readUInt8(7);
      const wakeOnFlow    = (flags & 0x01) === 1;

      console.log(`[decodeMkrPayload] Porta 2 Flow=${flowLmin}L/min Level=${levelPercent}% T=${temperatureC}°C Batt=${battery_level}% WakeInt=${wakeOnFlow}`);
      return {
        flowLmin,
        levelPercent,
        temperatureC,
        battery_level,
        wakeOnFlow,
        _mkrDecoded: true,
        _port: 2,
      };
    }

    // Porta non riconosciuta o buffer troppo corto: lascia gestire al decoder generico
    return null;
  } catch {
    publicErrorLog();
    return null;
  }
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
    "co2Ppm",
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
  let decoded = msg.decoded_payload || msg.decoded || null;
  const rawB64 = msg.frm_payload ?? msg.payload_raw ?? msg.payload ?? null;
  const payloadMeta = frmPayloadToBuffer(rawB64);
  const buf = payloadMeta.ok ? payloadMeta.buffer : null;

  // ---- MKR WAN 1310: tenta decoder nativo prima del fallback generico ----
  // Il f_port determina il tipo di nodo (1=CO2/Ambiente, 2=Idrico)
  const fPort = msg.f_port ?? msg.port ?? null;
  if (!decoded && buf && Number.isInteger(fPort)) {
    const mkrDecoded = decodeMkrPayload(buf, fPort);
    if (mkrDecoded) {
      decoded = mkrDecoded;
      console.log(`[ttnIngest] Payload MKR WAN 1310 decodificato (porta ${fPort}):`, decoded);
    }
  }

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
        ? "Database momentaneamente irraggiungibile: la misura non è stata salvata."
        : "Errore durante l'accesso al database.",
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
 * Pipeline di ingestione principale per i webhook di The Things Network (TTN).
 * 
 * Flusso:
 * 1. Validazione schema Joi (Strict)
 * 2. Verifica Whitelist DevEUI
 * 3. Controllo Rate-Limit (Flood Protection)
 * 4. Deduplicazione Frame Counter (LoRaWAN Best Practice)
 * 5. Salvataggio asincrono su PostgreSQL
 * 6. Inserimento in coda di analisi intelligente (OOM Prevention)
 * 
 * @param {Object} body - Il payload JSON inviato da TTN
 * @returns {Promise<{ok: boolean, status: number, detail: Object}>} Esito dell'operazione
 */
async function ingestTtnWebhook(body) {
  const tsStart = Date.now();
  console.log(`[INGEST_START] Ricevuto segnale da ${body?.end_device_ids?.dev_eui || 'unknown'}`);
  try {
    // Validazione Joi strict
    const validation = validateTtnPayload(body);
    if (!validation.valid) {
      return {
        ok: false,
        status: STATUS_BAD_REQUEST,
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
    return { ok: false, status: STATUS_BAD_REQUEST, detail: { error: "dev_eui_missing" } };
  }

  // WHITELIST RIGOROSA (Senior Security Engineer Mode)
  const isAuthorized = AUTHORIZED_DEV_EUIS.some(id => id.toUpperCase() === devEui.toUpperCase());
  
  if (!isAuthorized) {
    publicErrorLog();
    return { 
      ok: false, 
      status: STATUS_UNAUTHORIZED, 
      detail: { 
        error: "unauthorized_device", 
        message: "Dispositivo non presente nella whitelist di sicurezza",
        received: devEui,
        expectedOneOf: AUTHORIZED_DEV_EUIS
      } 
    };
  }

  // 1. RATE LIMITING PER devEUI (Protegge il server dai nodi "impazziti")
  const lastSeen = DEV_EUI_RATE_LIMIT_MAP.get(devEui) || 0;
  const nowMs = Date.now();
  if (nowMs - lastSeen < MIN_INTERVAL_MS) {
    // Rate limit silenziato
    return { 
      ok: false, 
      status: STATUS_RATE_LIMIT, 
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
        return { 
          ok: false, 
          status: STATUS_OK, 
          detail: { error: "duplicate_frame", devEui, fCnt, lastCnt } 
        };
      }
    }
    LAST_FRAME_COUNTERS.set(devEui, fCnt);
  }

  // 2. SESSIONE ATOMICA (Senior Architect Implementation)
  // Usiamo un singolo client per tutta la pipeline per garantire visibilità e consistenza
  return await pgStore.withClient(async (client) => {
    let sensor;
    try {
      // 2a. Ricerca Sensore (Case-Insensitive grazie a normalizeDevEui)
      sensor = await pgStore.findSensorByDevEui(devEui, client);
      
      // 2b. Auto-Provisioning Idempotente
      if (!sensor) {
        console.log(`[AUTO_PROVISIONING] Creazione nodo autorizzato: ${devEui}`);
        // Determina il tipo in base al nome del device
        const inferred = extractSensorData(devEui, {}, null);
        sensor = await pgStore.insertSensor({
          dev_eui: devEui,
          name: `Nodo ${devEui}`,
          location: "Generale",
          type: inferred.type !== 'unknown' ? inferred.type : "Ambiente",
        }, client);

        // Task asincrono per rinfrescare la topologia globale
        setTimeout(async () => {
          try {
            const top = await fetchTopology();
            updateTopology(top);
          } catch {
            publicErrorLog();
          }
        }, 100);
      }
    } catch (err) {
      return databaseFailureResponse(err, "provisioning");
    }

    if (!sensor || !sensor.id) {
      return { ok: false, status: STATUS_SERVER_ERROR, detail: { error: "sensor_identity_loss", devEui } };
    }

    const sensorId = parseInt(sensor.id);

    // Registra reboot hardware se rilevato (contatore resettato)
    const fCnt = validatedData.uplink_message?.f_cnt;
    const lastCnt = LAST_FRAME_COUNTERS.get(devEui);
    if (fCnt !== undefined && lastCnt !== undefined && fCnt < 5 && lastCnt > 100) {
       void recordSensorReboot(sensorId).catch(() => publicErrorLog());
    }
    LAST_FRAME_COUNTERS.set(devEui, fCnt);

    // ---- ESTRAZIONE VALORE PRIMARIO ----
    // Per payload MKR (_mkrDecoded=true), `value` deve essere la temperatura (campo
    // semantico del DB). pickDecodedNumeric() ritornerebbe co2Ppm per primo (trovato
    // prima di temperatureC nell'object), causando 720 ppm salvati come 720°C.
    let value;
    if (decoded?._mkrDecoded && Number.isFinite(Number(decoded.temperatureC))) {
      // Path MKR: usa direttamente temperatureC come valore primario
      value = Number(decoded.temperatureC);
    } else {
      // Path legacy/generico: usa il primo campo numerico trovato
      value = pickDecodedNumeric(decoded);
    }
    let battery = pickBatteryDecoded(decoded);

    // Gestione Binary Fallback (solo se nessun decoded disponibile)
    if (value == null && buf && buf.length > 0) {
      const dec = decodeBinaryForSensorType(buf, sensor.type);
      value = dec.value;
      if (battery == null) battery = dec.battery;
    }

    // Sanity Check Valore Numerico
    if (value == null || !isFinite(Number(value))) {
       return { ok: false, status: STATUS_BAD_REQUEST, detail: { error: "numeric_value_missing", devEui } };
    }


    const radio = sanitizeRadio(rssi, snr);
    const tsUtc = parseIngestTimestampUtc(tsRaw);
    const sensorInfo = extractSensorData(devEui, decoded, sensor);

    const co2ValueRaw =
      sensorInfo.type === "air" && Number.isFinite(Number(sensorInfo.data.co2Ppm))
        ? Math.floor(Number(sensorInfo.data.co2Ppm))
        : null;
    const co2SensorFault =
      co2ValueRaw === 0xFFFF || String(decoded?.sensorFault || "").toLowerCase() === "errore sensore";
    const normalizedCo2 = co2SensorFault ? null : co2ValueRaw;
    if (co2SensorFault) {
      sensorInfo.data.co2Ppm = null;
      sensorInfo.data.sensorFault = "Errore Sensore";
    }

    const measurementData = {
      sensorId: sensorId,
      value: Number(value),
      sensorType: sensorInfo.sensorType || sensor.type,
      rssi: radio.rssi,
      snr: radio.snr,
      battery_level: battery,
      f_cnt: fCnt,
      timestamp: tsUtc,
      co2: normalizedCo2,
      voc: (sensorInfo.type === 'air' && Number.isFinite(Number(sensorInfo.data.vocIndex))) ? Math.floor(Number(sensorInfo.data.vocIndex)) : null,
      lux: (sensorInfo.type === 'air' && Number.isFinite(Number(sensorInfo.data.lux))) ? Math.floor(Number(sensorInfo.data.lux)) : null,
    };

    try {
      await pgStore.insertMeasurement(measurementData, client);
    } catch (err) {
      return databaseFailureResponse(err, "insertMeasurement");
    }

    // Avvio analisi asincrona (Motore parallelo ottimizzato con protezione OOM)
    setTimeout(() => {
      // Se la coda è piena, scarta il task più vecchio per far posto al nuovo (FIFO protection)
      if (analysisQueue.length >= MAX_ANALYSIS_QUEUE_SIZE) {
        analysisQueue.shift();
        publicErrorLog();
      }

      analysisQueue.push(async () => {
        try {
          if (sensorInfo.type === 'water') await analyzeWaterPacket(sensor, devEui, decoded, tsUtc);
          if (sensorInfo.type === 'air' || sensorInfo.type === 'Ambiente') {
            await analyzeAirPacket(sensor, devEui, sensorInfo.data, tsUtc);
          }
          // Telemetria Manutenzione
          await analyzeMaintenanceTelemetry({
            sensorId: sensor.id,
            devEui,
            sensorName: sensor.name,
            location: sensor.location,
            battery_level: battery,
            rssi: radio.rssi,
            timestamp: tsUtc
          });
        } catch (err) {
          publicErrorLog();
        } finally {
          activeAnalyses--;
          processNextAnalysis();
        }
      });
      processNextAnalysis();
    }, 0);

    return {
      ok: true,
      status: 200,
      detail: { ok: true, sensorId, devEui, value, timestamp: tsUtc.toISOString() }
    };
  });
} catch {
  publicErrorLog();
  return {
    ok: false,
    status: 500,
    detail: { error: "internal_server_error", message: "Error" }
  };
}
}

/**
 * Gestore coda analisi (Motore)
 */
function processNextAnalysis() {
  while (analysisQueue.length > 0 && activeAnalyses < MAX_CONCURRENT_ANALYSES) {
    const nextTask = analysisQueue.shift();
    activeAnalyses++;
    nextTask().catch(() => publicErrorLog());
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

  } catch {
    publicErrorLog();
  }
}

/**
 * Analizza pacchetto dati aria con "Misuratore dati LORA Aria"
 */
async function analyzeAirPacket(sensor, devEui, airData, timestamp) {
  try {
    // Esegui analisi intelligente aria
    const analysis = await analyzeAirData({
      nodeId: devEui,
      zoneId: sensor.location,
      location: sensor.location,
      co2: airData.co2Ppm || null,
      voc: airData.vocIndex || null,
      lux: airData.lux || null,
      timestamp: timestamp,
      maxThreshold: sensor.max_threshold || null
    });

    if (analysis.alerts.length > 0) {
      console.log(`[airAnalytics] Alert generati per ${devEui}:`, analysis.alerts.map(a => a.title));
    }

  } catch {
    publicErrorLog();
  }
}

module.exports = {
  extractTtnFields,
  binaryDecodeCategory,
  decodeBinaryForSensorType,
  decodeMkrPayload,          // Esportato per test unitari
  ingestTtnWebhook,
  frmPayloadToBuffer,
  parseIngestTimestampUtc,
  analyzeWaterPacket,
  validateTtnPayload,
  ttnIngestSchema,
};
