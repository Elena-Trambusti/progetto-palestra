-- Migration 003: Schema Telemetria Universale
-- Standardizza colonne per monitoraggio stato sensori

-- Rinomina e standardizza colonne measurements per telemetria
DO $$
BEGIN
  -- Rinomina battery -> battery_level se esiste
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'measurements' AND column_name = 'battery') THEN
    ALTER TABLE measurements RENAME COLUMN battery TO battery_level;
  END IF;
  
  -- Aggiungi battery_level se non esiste
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'measurements' AND column_name = 'battery_level') THEN
    ALTER TABLE measurements ADD COLUMN battery_level DECIMAL(5,2);
  END IF;
  
  -- Modifica rssi da DOUBLE a INTEGER per precisione dBm
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'measurements' AND column_name = 'rssi') THEN
    ALTER TABLE measurements ALTER COLUMN rssi TYPE INTEGER USING rssi::INTEGER;
  ELSE
    ALTER TABLE measurements ADD COLUMN rssi INTEGER;
  END IF;

  -- Assicura colonne ambientali richieste dall'ingest
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'measurements' AND column_name = 'co2') THEN
    ALTER TABLE measurements ADD COLUMN co2 INTEGER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'measurements' AND column_name = 'voc') THEN
    ALTER TABLE measurements ADD COLUMN voc INTEGER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'measurements' AND column_name = 'lux') THEN
    ALTER TABLE measurements ADD COLUMN lux INTEGER;
  END IF;
  
  -- Assicura sensor_type esista e sia VARCHAR(50)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'measurements' AND column_name = 'sensor_type') THEN
    ALTER TABLE measurements ADD COLUMN sensor_type VARCHAR(50);
  END IF;
  
  -- Aggiungi indici per query telemetria efficienti
  CREATE INDEX IF NOT EXISTS idx_measurements_battery ON measurements (battery_level) WHERE battery_level IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_measurements_rssi ON measurements (rssi) WHERE rssi IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_measurements_telemetry ON measurements (sensor_id, battery_level, rssi, timestamp DESC);
  
END $$;

-- Tabella per tracking stato manutenzione sensori
CREATE TABLE IF NOT EXISTS sensor_maintenance_status (
  id SERIAL PRIMARY KEY,
  sensor_id INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  battery_alert_sent BOOLEAN DEFAULT FALSE,
  battery_alert_sent_at TIMESTAMPTZ,
  signal_alert_sent BOOLEAN DEFAULT FALSE,
  signal_alert_sent_at TIMESTAMPTZ,
  maintenance_count INTEGER DEFAULT 0,
  last_check_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sensor_id)
);

-- Indici per sensor_maintenance_status
CREATE INDEX IF NOT EXISTS idx_maintenance_sensor ON sensor_maintenance_status (sensor_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_alerts ON sensor_maintenance_status (battery_alert_sent, signal_alert_sent);

-- Funzione per ottenere stato telemetria sensore
CREATE OR REPLACE FUNCTION get_sensor_telemetry(p_sensor_id INTEGER)
RETURNS TABLE (
  last_battery DECIMAL,
  last_rssi INTEGER,
  last_seen TIMESTAMPTZ,
  avg_battery_24h DECIMAL,
  avg_rssi_24h INTEGER,
  reading_count_24h INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.battery_level as last_battery,
    m.rssi as last_rssi,
    m.timestamp as last_seen,
    (SELECT AVG(battery_level)::DECIMAL FROM measurements 
     WHERE sensor_id = p_sensor_id AND timestamp > NOW() - INTERVAL '24 hours'),
    (SELECT AVG(rssi)::INTEGER FROM measurements 
     WHERE sensor_id = p_sensor_id AND timestamp > NOW() - INTERVAL '24 hours'),
    (SELECT COUNT(*)::INTEGER FROM measurements 
     WHERE sensor_id = p_sensor_id AND timestamp > NOW() - INTERVAL '24 hours')
  FROM measurements m
  WHERE m.sensor_id = p_sensor_id
  ORDER BY m.timestamp DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE sensor_maintenance_status IS 'Tracking alert manutenzione per stato batteria e segnale';
COMMENT ON FUNCTION get_sensor_telemetry IS 'Restituisce telemetria aggregata ultima lettura e statistiche 24h';
