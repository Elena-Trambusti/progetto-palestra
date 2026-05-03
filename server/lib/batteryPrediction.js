/**
 * Battery Prediction - ML semplice per predizione scarica batteria
 * Usa regressione lineare su storico 30 giorni
 */
const { getPool } = require("./postgresStore");

/**
 * Regressione lineare semplice
 * y = mx + b
 * @param {Array<{x: number, y: number}>} points
 * @returns {{m: number, b: number}}
 */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { m: 0, b: points[0]?.y || 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const b = (sumY - m * sumX) / n;

  return { m, b };
}

/**
 * Ottiene storico batteria per un sensore
 * @param {string} devEui - DevEUI del sensore
 * @param {number} days - Giorni di storico (default: 30)
 */
async function getBatteryHistory(devEui, days = 30) {
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        m.battery_level as battery,
        m.timestamp as ts
      FROM measurements m
      JOIN sensors s ON m.sensor_id = s.id
      WHERE s.dev_eui = $1
        AND m.battery_level IS NOT NULL
        AND m.timestamp > NOW() - INTERVAL '${days} days'
      ORDER BY m.timestamp ASC
    `, [devEui]);

    return result.rows.map(r => ({
      battery: parseFloat(r.battery),
      timestamp: new Date(r.ts),
    }));
  } finally {
    client.release();
  }
}

/**
 * Predice quando la batteria si scaricherà
 * @param {string} devEui - DevEUI del sensore
 * @returns {{
 *   predictedEmptyDate: Date|null,
 *   daysRemaining: number|null,
 *   confidence: 'high'|'medium'|'low',
 *   trend: 'draining'|'stable'|'charging'|'unknown'
 * }}
 */
async function predictBatteryEmpty(devEui) {
  const history = await getBatteryHistory(devEui, 30);
  
  if (!history || history.length < 5) {
    return {
      predictedEmptyDate: null,
      daysRemaining: null,
      confidence: 'low',
      trend: 'unknown',
      reason: 'Insufficient data (minimum 5 readings required)',
    };
  }

  // Converte timestamp in giorni dal primo campione
  const firstTs = history[0].timestamp.getTime();
  const points = history.map(h => ({
    x: (h.timestamp.getTime() - firstTs) / (1000 * 60 * 60 * 24), // giorni
    y: h.battery,
  }));

  const { m, b } = linearRegression(points);

  // Determina trend
  let trend = 'stable';
  if (m < -0.5) trend = 'draining'; // Perde più di 0.5% al giorno
  else if (m > 0.5) trend = 'charging';

  // Se la batteria è stabile o in carica, non predire scarica
  if (trend !== 'draining') {
    return {
      predictedEmptyDate: null,
      daysRemaining: null,
      confidence: 'high',
      trend,
      reason: trend === 'stable' ? 'Battery stable' : 'Battery charging',
    };
  }

  // Calcola quando raggiunge 0%
  // y = mx + b => x = (y - b) / m
  // Quando y = 0: x = -b / m
  const daysToEmpty = -b / m;
  const daysRemaining = Math.max(0, Math.round(daysToEmpty - points[points.length - 1].x));

  // Calcola confidenza basata sui dati
  let confidence = 'low';
  if (points.length > 20) confidence = 'high';
  else if (points.length > 10) confidence = 'medium';

  // Se predice più di 365 giorni, probabilmente è un errore
  if (daysRemaining > 365 || daysRemaining < 0) {
    return {
      predictedEmptyDate: null,
      daysRemaining: null,
      confidence: 'low',
      trend,
      reason: 'Unrealistic prediction (check sensor data)',
    };
  }

  const predictedEmptyDate = new Date();
  predictedEmptyDate.setDate(predictedEmptyDate.getDate() + daysRemaining);

  return {
    predictedEmptyDate,
    daysRemaining,
    confidence,
    trend,
    drainRatePerDay: Math.abs(m).toFixed(2),
  };
}

/**
 * Analizza tutti i sensori e restituisce predizioni batteria
 */
async function analyzeAllBatteries() {
  const pool = getPool();
  if (!pool) return [];

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, dev_eui, name, location, type
      FROM sensors
      WHERE type IN ('water', 'air', 'temperature')
    `);

    const predictions = await Promise.all(
      result.rows.map(async (sensor) => {
        const prediction = await predictBatteryEmpty(sensor.dev_eui);
        return {
          sensorId: sensor.id,
          devEui: sensor.dev_eui,
          name: sensor.name,
          location: sensor.location,
          type: sensor.type,
          prediction,
        };
      })
    );

    // Filtra solo quelli che hanno una predizione valida e urgente (< 14 giorni)
    return predictions.filter(p => 
      p.prediction.daysRemaining !== null && 
      p.prediction.daysRemaining < 14 &&
      p.prediction.confidence !== 'low'
    );
  } finally {
    client.release();
  }
}

module.exports = {
  predictBatteryEmpty,
  analyzeAllBatteries,
  linearRegression,
  getBatteryHistory,
};
