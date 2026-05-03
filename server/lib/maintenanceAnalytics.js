/**
 * Sesto Senso Manutenzione - Analisi telemetria sensori
 * Monitora stato batteria e segnale LoRa, genera alert manutenzione preventiva
 */

const { getPool } = require('./postgresStore');
const { sendMaintenanceAlert, MAINTENANCE_TYPES } = require('./telegramNotifier');

// Soglie configurabili via env
const BATTERY_CRITICAL_VOLTS = Number(process.env.BATTERY_CRITICAL_VOLTS) || 3.4;
const BATTERY_CRITICAL_PCT = Number(process.env.BATTERY_CRITICAL_PCT) || 15;
const BATTERY_WARNING_VOLTS = Number(process.env.BATTERY_WARNING_VOLTS) || 3.6;
const BATTERY_WARNING_PCT = Number(process.env.BATTERY_WARNING_PCT) || 25;
const RSSI_WARNING = Number(process.env.RSSI_WARNING) || -115;
const RSSI_CRITICAL = Number(process.env.RSSI_CRITICAL) || -125;

// Cooldown alert (in ms) - evita spam
const ALERT_COOLDOWN_MS = Number(process.env.MAINTENANCE_ALERT_COOLDOWN_MS) || 60 * 60 * 1000; // 1 ora

/**
 * Analizza telemetria sensore e genera alert manutenzione se necessario
 * Chiamato ad ogni ingest di dati
 */
async function analyzeMaintenanceTelemetry({
  sensorId,
  devEui,
  sensorName,
  location,
  batteryLevel,
  rssi,
  timestamp
}) {
  const alerts = [];
  
  try {
    // Verifica batteria
    if (batteryLevel != null) {
      const batteryAlert = checkBatteryLevel(batteryLevel, devEui, sensorName, location);
      if (batteryAlert) {
        const shouldNotify = await shouldSendAlert(sensorId, 'battery');
        if (shouldNotify) {
          await sendMaintenanceAlert({
            type: MAINTENANCE_TYPES.BATTERY_LOW,
            sensorId: devEui,
            sensorName,
            location,
            value: batteryLevel,
            unit: isPercentBattery(batteryLevel) ? '%' : 'V',
            threshold: isPercentBattery(batteryLevel) ? BATTERY_CRITICAL_PCT : BATTERY_CRITICAL_VOLTS,
            timestamp
          });
          await markAlertSent(sensorId, 'battery');
          alerts.push(batteryAlert);
        }
      }
    }
    
    // Verifica segnale RSSI
    if (rssi != null) {
      const signalAlert = checkSignalStrength(rssi, devEui, sensorName, location);
      if (signalAlert) {
        const shouldNotify = await shouldSendAlert(sensorId, 'signal');
        if (shouldNotify) {
          await sendMaintenanceAlert({
            type: MAINTENANCE_TYPES.SIGNAL_WEAK,
            sensorId: devEui,
            sensorName,
            location,
            value: rssi,
            unit: 'dBm',
            threshold: RSSI_WARNING,
            timestamp
          });
          await markAlertSent(sensorId, 'signal');
          alerts.push(signalAlert);
        }
      }
    }
    
    if (alerts.length > 0) {
      console.log(`[maintenance] Alert generati per ${devEui}:`, alerts.map(a => a.type));
    }
    
    // Aggiorna ultimo check
    await updateLastCheck(sensorId);
    
  } catch (err) {
    console.error('[maintenance] Errore analisi telemetria:', err.message);
  }
  
  return alerts;
}

/**
 * Determina se la batteria è espressa in percentuale o volt
 */
function isPercentBattery(value) {
  // Se > 10, probabilmente è percentuale (0-100)
  return value > 10;
}

/**
 * Verifica livello batteria e restituisce alert se critico
 */
function checkBatteryLevel(level, devEui, sensorName, location) {
  const isPercent = isPercentBattery(level);
  
  if (isPercent) {
    // Soglie percentuali
    if (level <= BATTERY_CRITICAL_PCT) {
      return {
        type: 'battery_critical',
        severity: 'critical',
        message: `🔋 Batteria CRITICA: ${sensorName} (${location}) - ${level.toFixed(1)}%`,
        devEui,
        value: level,
        threshold: BATTERY_CRITICAL_PCT
      };
    } else if (level <= BATTERY_WARNING_PCT) {
      return {
        type: 'battery_warning',
        severity: 'warning',
        message: `🔋 Batteria bassa: ${sensorName} (${location}) - ${level.toFixed(1)}%`,
        devEui,
        value: level,
        threshold: BATTERY_WARNING_PCT
      };
    }
  } else {
    // Soglie voltaggio (Li-Ion 3.7V nominali, 3.0V cutoff)
    if (level <= BATTERY_CRITICAL_VOLTS) {
      return {
        type: 'battery_critical_volts',
        severity: 'critical',
        message: `🔋 Batteria CRITICA: ${sensorName} (${location}) - ${level.toFixed(2)}V`,
        devEui,
        value: level,
        threshold: BATTERY_CRITICAL_VOLTS
      };
    } else if (level <= BATTERY_WARNING_VOLTS) {
      return {
        type: 'battery_warning_volts',
        severity: 'warning',
        message: `🔋 Batteria bassa: ${sensorName} (${location}) - ${level.toFixed(2)}V`,
        devEui,
        value: level,
        threshold: BATTERY_WARNING_VOLTS
      };
    }
  }
  
  return null;
}

/**
 * Verifica segnale RSSI e restituisce alert se debole
 */
function checkSignalStrength(rssi, devEui, sensorName, location) {
  if (rssi >= RSSI_WARNING) {
    // Segnale OK
    return null;
  }
  
  if (rssi <= RSSI_CRITICAL) {
    return {
      type: 'signal_critical',
      severity: 'critical',
      message: `📡 Segnale CRITICO: ${sensorName} (${location}) - ${rssi} dBm`,
      devEui,
      value: rssi,
      threshold: RSSI_CRITICAL,
      hint: 'Considerare spostamento sensore o aggiunta gateway'
    };
  }
  
  return {
    type: 'signal_warning',
    severity: 'warning',
    message: `📡 Segnale debole: ${sensorName} (${location}) - ${rssi} dBm`,
    devEui,
    value: rssi,
    threshold: RSSI_WARNING,
    hint: 'Verificare ostacoli o distanza dal gateway'
  };
}

/**
 * Verifica se possiamo inviare alert (cooldown)
 */
async function shouldSendAlert(sensorId, alertType) {
  const pool = getPool();
  if (!pool) return false;
  
  try {
    const result = await pool.query(
      `SELECT ${alertType}_alert_sent_at, ${alertType}_alert_sent 
       FROM sensor_maintenance_status 
       WHERE sensor_id = $1`,
      [sensorId]
    );
    
    if (result.rows.length === 0) {
      // Nessun record, crea e permetti alert
      await pool.query(
        `INSERT INTO sensor_maintenance_status (sensor_id) VALUES ($1) ON CONFLICT (sensor_id) DO NOTHING`,
        [sensorId]
      );
      return true;
    }
    
    const row = result.rows[0];
    const lastAlert = row[`${alertType}_alert_sent_at`];
    const wasSent = row[`${alertType}_alert_sent`];
    
    if (!wasSent || !lastAlert) {
      return true;
    }
    
    // Verifica cooldown
    const lastAlertTime = new Date(lastAlert).getTime();
    const now = Date.now();
    
    return (now - lastAlertTime) > ALERT_COOLDOWN_MS;
    
  } catch (err) {
    console.error('[maintenance] Errore verifica cooldown:', err.message);
    return true; // In caso di errore, permetti alert
  }
}

/**
 * Marca alert come inviato
 */
async function markAlertSent(sensorId, alertType) {
  const pool = getPool();
  if (!pool) return;
  
  try {
    await pool.query(
      `INSERT INTO sensor_maintenance_status (sensor_id, ${alertType}_alert_sent, ${alertType}_alert_sent_at)
       VALUES ($1, TRUE, NOW())
       ON CONFLICT (sensor_id) 
       DO UPDATE SET ${alertType}_alert_sent = TRUE, ${alertType}_alert_sent_at = NOW()`,
      [sensorId]
    );
  } catch (err) {
    console.error('[maintenance] Errore mark alert:', err.message);
  }
}

/**
 * Aggiorna timestamp ultimo check
 */
async function updateLastCheck(sensorId) {
  const pool = getPool();
  if (!pool) return;
  
  try {
    await pool.query(
      `INSERT INTO sensor_maintenance_status (sensor_id, last_check_at)
       VALUES ($1, NOW())
       ON CONFLICT (sensor_id) 
       DO UPDATE SET last_check_at = NOW(), maintenance_count = sensor_maintenance_status.maintenance_count + 1`,
      [sensorId]
    );
  } catch (err) {
    console.error('[maintenance] Errore update check:', err.message);
  }
}

/**
 * Reset stato alert (utile dopo manutenzione effettuata)
 */
async function resetMaintenanceAlert(sensorId, alertType) {
  const pool = getPool();
  if (!pool) return;
  
  try {
    await pool.query(
      `UPDATE sensor_maintenance_status 
       SET ${alertType}_alert_sent = FALSE, ${alertType}_alert_sent_at = NULL
       WHERE sensor_id = $1`,
      [sensorId]
    );
    console.log(`[maintenance] Reset alert ${alertType} per sensore ${sensorId}`);
  } catch (err) {
    console.error('[maintenance] Errore reset alert:', err.message);
  }
}

/**
 * Ottieni stato manutenzione di tutti i sensori
 */
async function getMaintenanceStatus() {
  const pool = getPool();
  if (!pool) return [];
  
  try {
    const result = await pool.query(`
      SELECT 
        s.id, s.dev_eui, s.name, s.location, s.type,
        m.battery_alert_sent, m.battery_alert_sent_at,
        m.signal_alert_sent, m.signal_alert_sent_at,
        m.maintenance_count, m.last_check_at
      FROM sensors s
      LEFT JOIN sensor_maintenance_status m ON s.id = m.sensor_id
      ORDER BY s.name
    `);
    return result.rows;
  } catch (err) {
    console.error('[maintenance] Errore get status:', err.message);
    return [];
  }
}

module.exports = {
  analyzeMaintenanceTelemetry,
  checkBatteryLevel,
  checkSignalStrength,
  resetMaintenanceAlert,
  getMaintenanceStatus,
  BATTERY_CRITICAL_VOLTS,
  BATTERY_CRITICAL_PCT,
  BATTERY_WARNING_VOLTS,
  BATTERY_WARNING_PCT,
  RSSI_WARNING,
  RSSI_CRITICAL
};
