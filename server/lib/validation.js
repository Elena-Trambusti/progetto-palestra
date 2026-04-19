/**
 * Validazione rigorosa per payload sensori e API input
 */

/**
 * Schema validazione per reading payload
 */
const READING_SCHEMA = {
  nodeId: { type: 'string', required: true, minLength: 3, maxLength: 50, pattern: /^[a-zA-Z0-9\-_]+$/ },
  zoneId: { type: 'string', required: true, minLength: 3, maxLength: 50, pattern: /^[a-zA-Z0-9\-_]+$/ },
  gatewayId: { type: 'string', required: true, minLength: 3, maxLength: 50, pattern: /^[a-zA-Z0-9\-_]+$/ },
  timestamp: { type: 'string', required: false, format: 'iso8601' }, // Optional per legacy
  source: { type: 'string', required: false, enum: ['lora-gateway', 'ttn-webhook', 'simulator'] }, // Optional per legacy
  batteryPercent: { type: 'number', required: false, min: 0, max: 100 },
  rssi: { type: 'number', required: false, min: -140, max: -30 },
  snr: { type: 'number', required: false, min: -20, max: 30 },
  sensors: { type: 'object', required: false, validate: validateSensors } // Optional per legacy
};

/**
 * Validazione valori sensori (supporta formato legacy e nuovo)
 */
function validateSensors(sensors) {
  if (!sensors || typeof sensors !== 'object') {
    return { valid: false, error: 'sensors must be an object' };
  }

  const sensorSchemas = {
    temperatureC: { type: 'number', min: -50, max: 100 },
    humidityPercent: { type: 'number', min: 0, max: 100 },
    co2Ppm: { type: 'number', min: 0, max: 10000 },
    vocIndex: { type: 'number', min: 0, max: 500 },
    lightLux: { type: 'number', min: 0, max: 100000 },
    flowLmin: { type: 'number', min: 0, max: 1000 },
    waterLevelPercent: { type: 'number', min: 0, max: 100 },
    levelPercent: { type: 'number', min: 0, max: 100 }, // Legacy format
    pressureKpa: { type: 'number', min: 0, max: 1000 }
  };

  for (const [key, value] of Object.entries(sensors)) {
    const schema = sensorSchemas[key];
    if (!schema) {
      // Skip unknown fields for backward compatibility
      continue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { valid: false, error: `${key} must be a valid number` };
    }

    if (value < schema.min || value > schema.max) {
      return { valid: false, error: `${key} must be between ${schema.min} and ${schema.max}` };
    }
  }

  return { valid: true };
}

/**
 * Validazione campo singolo
 */
function validateField(value, schema) {
  if (schema.required && (value === undefined || value === null || value === '')) {
    return { valid: false, error: `${schema.field || 'field'} is required` };
  }

  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return { valid: false, error: `${schema.field || 'field'} must be a string` };
    }
    
    if (schema.minLength && value.length < schema.minLength) {
      return { valid: false, error: `${schema.field || 'field'} must be at least ${schema.minLength} characters` };
    }
    
    if (schema.maxLength && value.length > schema.maxLength) {
      return { valid: false, error: `${schema.field || 'field'} must be at most ${schema.maxLength} characters` };
    }
    
    if (schema.pattern && !schema.pattern.test(value)) {
      return { valid: false, error: `${schema.field || 'field'} contains invalid characters` };
    }
    
    if (schema.enum && !schema.enum.includes(value)) {
      return { valid: false, error: `${schema.field || 'field'} must be one of: ${schema.enum.join(', ')}` };
    }
    
    if (schema.format === 'iso8601') {
      const date = new Date(value);
      if (isNaN(date.getTime()) || date.toISOString() !== value) {
        return { valid: false, error: `${schema.field || 'field'} must be a valid ISO 8601 timestamp` };
      }
    }
  }

  if (schema.type === 'number') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return { valid: false, error: `${schema.field || 'field'} must be a valid number` };
    }
    
    if (schema.min !== undefined && num < schema.min) {
      return { valid: false, error: `${schema.field || 'field'} must be at least ${schema.min}` };
    }
    
    if (schema.max !== undefined && num > schema.max) {
      return { valid: false, error: `${schema.field || 'field'} must be at most ${schema.max}` };
    }
  }

  if (schema.type === 'object' && schema.validate) {
    return schema.validate(value);
  }

  return { valid: true };
}

/**
 * Validazione completo payload reading
 */
function validateReading(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }

  // Check required fields
  const requiredFields = ['nodeId', 'zoneId', 'gatewayId'];
  for (const field of requiredFields) {
    if (!payload[field]) {
      return { valid: false, error: `${field} is required` };
    }
  }

  // Validate required fields
  for (const field of requiredFields) {
    const schema = READING_SCHEMA[field];
    const fieldSchema = { ...schema, field };
    const result = validateField(payload[field], fieldSchema);
    if (!result.valid) {
      return result;
    }
  }

  // Validate optional numeric fields
  const numericFields = ['batteryPercent', 'rssi', 'snr'];
  for (const field of numericFields) {
    if (payload[field] !== undefined) {
      const schema = READING_SCHEMA[field];
      const fieldSchema = { ...schema, field };
      const result = validateField(payload[field], fieldSchema);
      if (!result.valid) {
        return result;
      }
    }
  }

  // Validate sensors object OR legacy sensor fields at top level
  if (payload.sensors) {
    const result = validateSensors(payload.sensors);
    if (!result.valid) {
      return result;
    }
  } else {
    // Legacy format: check for sensor fields at top level
    const sensorFields = ['temperatureC', 'humidityPercent', 'co2Ppm', 'vocIndex', 'lightLux', 'flowLmin', 'levelPercent', 'waterLevelPercent', 'pressureKpa'];
    const legacySensors = {};
    
    for (const field of sensorFields) {
      if (payload[field] !== undefined) {
        legacySensors[field] = payload[field];
      }
    }
    
    if (Object.keys(legacySensors).length > 0) {
      const result = validateSensors(legacySensors);
      if (!result.valid) {
        return result;
      }
    }
  }

  // Validate optional fields
  const optionalFields = ['timestamp', 'source'];
  for (const field of optionalFields) {
    if (payload[field] !== undefined) {
      const schema = READING_SCHEMA[field];
      const fieldSchema = { ...schema, field };
      const result = validateField(payload[field], fieldSchema);
      if (!result.valid) {
        return result;
      }
    }
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

    // Sanitization basica
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
  if (!sensorId || typeof sensorId !== 'string') {
    return { valid: false, error: 'Sensor ID is required and must be a string' };
  }

  if (sensorId.length < 3 || sensorId.length > 50) {
    return { valid: false, error: 'Sensor ID must be between 3 and 50 characters' };
  }

  if (!/^[a-zA-Z0-9\-_]+$/.test(sensorId)) {
    return { valid: false, error: 'Sensor ID can only contain letters, numbers, hyphens and underscores' };
  }

  return { valid: true };
}

module.exports = {
  validateReading,
  validateQueryParams,
  validateSensorId,
  validateSensors
};
