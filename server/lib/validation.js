/**
 * Validazione rigorosa per payload sensori e API input
 */
const Joi = require('joi');
const { ZONES } = require('./zonesData');

const validZoneIds = ZONES.map(z => z.id);

const sensorSchema = Joi.object({
  temperatureC: Joi.number().min(-50).max(100).optional(),
  humidityPercent: Joi.number().min(0).max(100).optional(),
  co2Ppm: Joi.number().min(0).max(10000).optional(),
  vocIndex: Joi.number().min(0).max(500).optional(),
  lightLux: Joi.number().min(0).max(100000).optional(),
  flowLmin: Joi.number().min(0).max(1000).optional(),
  waterLevelPercent: Joi.number().min(0).max(100).optional(),
  levelPercent: Joi.number().min(0).max(100).optional(),
  pressureKpa: Joi.number().min(0).max(1000).optional()
});

const readingSchema = Joi.object({
  nodeId: Joi.string().min(3).max(50).pattern(/^[a-zA-Z0-9\-_]+$/).required(),
  zoneId: Joi.string().valid(...validZoneIds).required(),
  gatewayId: Joi.string().min(3).max(50).pattern(/^[a-zA-Z0-9\-_]+$/).required(),
  timestamp: Joi.string().isoDate().optional(),
  source: Joi.string().valid('lora-gateway', 'ttn-webhook', 'simulator').optional(),
  batteryPercent: Joi.number().min(0).max(100).optional(),
  battery_level: Joi.number().min(0).max(100).optional(),
  rssi: Joi.number().min(-160).max(-30).optional(),
  snr: Joi.number().min(-30).max(30).optional(),
  sensors: sensorSchema.optional()
}).unknown(true); // Allow legacy format sensors at root

/**
 * Validazione completo payload reading
 */
function validateReading(payload) {
  const { error } = readingSchema.validate(payload, { abortEarly: false });
  if (error) {
    return { valid: false, error: error.details.map(d => d.message).join(', ') };
  }

  // Legacy format check
  if (!payload.sensors) {
    const sensorFields = ['temperatureC', 'humidityPercent', 'co2Ppm', 'vocIndex', 'lightLux', 'flowLmin', 'levelPercent', 'waterLevelPercent', 'pressureKpa'];
    const legacySensors = {};
    for (const field of sensorFields) {
      if (payload[field] !== undefined) {
        legacySensors[field] = payload[field];
      }
    }
    if (Object.keys(legacySensors).length > 0) {
      const { error: sensorError } = sensorSchema.validate(legacySensors, { abortEarly: false });
      if (sensorError) {
        return { valid: false, error: sensorError.details.map(d => d.message).join(', ') };
      }
    }
  }

  return { valid: true };
}

/**
 * Validazione valori sensori (supporta formato legacy e nuovo)
 */
function validateSensors(sensors) {
  const { error } = sensorSchema.validate(sensors, { abortEarly: false });
  if (error) {
    return { valid: false, error: error.details.map(d => d.message).join(', ') };
  }
  return { valid: true };
}

/**
 * Validazione per query parameters
 */
function validateQueryParams(params, allowedParams) {
  const result = { valid: true, errors: [], sanitized: {} };
  
  if (!params || typeof params !== 'object') {
    return { valid: false, error: 'Query parameters must be an object' };
  }

  for (const [key, value] of Object.entries(params)) {
    if (!allowedParams.includes(key)) {
      result.errors.push(`Invalid parameter: ${key}`);
      continue;
    }

    if (typeof value === 'string') {
      result.sanitized[key] = value.trim().replace(/[<>]/g, '');
    } else {
      result.sanitized[key] = value;
    }
  }

  if (result.errors.length > 0) {
    result.valid = false;
    result.error = result.errors.join(', ');
  }

  return result;
}

/**
 * Validazione ID sensore per database
 */
function validateSensorId(sensorId) {
  const schema = Joi.string().min(3).max(50).pattern(/^[a-zA-Z0-9\-_]+$/).required();
  const { error } = schema.validate(sensorId);
  if (error) {
    return { valid: false, error: error.message };
  }
  return { valid: true };
}

module.exports = {
  validateReading,
  validateQueryParams,
  validateSensorId,
  validateSensors
};
