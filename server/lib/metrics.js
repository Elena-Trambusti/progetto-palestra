/**
 * Metrics Dashboard - Raccolta metriche sistema per monitoring
 */
const { getPool } = require("./postgresStore");

/**
 * Ottiene conteggio misure ultime 24h
 */
async function getMeasurementsCount24h() {
  const pool = getPool();
  if (!pool) return null;
  
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT COUNT(*) as count 
      FROM measurements 
      WHERE timestamp > NOW() - INTERVAL '24 hours'
    `);
    return parseInt(result.rows[0].count);
  } finally {
    client.release();
  }
}

/**
 * Ottiene numero sensori online (con misura recente)
 */
async function getOnlineSensors() {
  const pool = getPool();
  if (!pool) return null;
  
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT COUNT(DISTINCT sensor_id) as count 
      FROM measurements 
      WHERE timestamp > NOW() - INTERVAL '5 minutes'
    `);
    return parseInt(result.rows[0].count);
  } finally {
    client.release();
  }
}

/**
 * Ottiene numero totale sensori
 */
async function getTotalSensors() {
  const pool = getPool();
  if (!pool) return null;
  
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT COUNT(*) as count FROM sensors`);
    return parseInt(result.rows[0].count);
  } finally {
    client.release();
  }
}

/**
 * Ottiene alert manutenzione ultime 24h
 */
async function getMaintenanceAlerts24h() {
  const pool = getPool();
  if (!pool) return { battery: 0, signal: 0 };
  
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE battery_alert_sent_at > NOW() - INTERVAL '24 hours') as battery,
        COUNT(*) FILTER (WHERE signal_alert_sent_at > NOW() - INTERVAL '24 hours') as signal
      FROM sensor_maintenance_status
    `);
    return {
      battery: parseInt(result.rows[0].battery),
      signal: parseInt(result.rows[0].signal),
    };
  } finally {
    client.release();
  }
}

/**
 * Ottiene dimensione database
 */
async function getDatabaseSize() {
  const pool = getPool();
  if (!pool) return null;
  
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size,
             pg_database_size(current_database()) as bytes
    `);
    return {
      readable: result.rows[0].size,
      bytes: parseInt(result.rows[0].bytes),
    };
  } finally {
    client.release();
  }
}

/**
 * Raccoglie tutte le metriche per dashboard
 */
async function collectMetrics() {
  const [
    measurements24h,
    onlineSensors,
    totalSensors,
    alerts,
    dbSize,
  ] = await Promise.all([
    getMeasurementsCount24h(),
    getOnlineSensors(),
    getTotalSensors(),
    getMaintenanceAlerts24h(),
    getDatabaseSize(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    measurements: {
      count24h: measurements24h,
    },
    sensors: {
      total: totalSensors,
      online: onlineSensors,
      offline: totalSensors && onlineSensors ? totalSensors - onlineSensors : null,
    },
    alerts24h: alerts,
    database: dbSize,
  };
}

module.exports = {
  getMeasurementsCount24h,
  getOnlineSensors,
  getTotalSensors,
  getMaintenanceAlerts24h,
  getDatabaseSize,
  collectMetrics,
};
