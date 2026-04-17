-- Schema di riferimento (il server esegue anche CREATE IF NOT EXISTS all'avvio).
-- Utile per migrazioni manuali su PostgreSQL (es. Render).

CREATE TABLE IF NOT EXISTS sensors (
  id SERIAL PRIMARY KEY,
  dev_eui VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  min_threshold DOUBLE PRECISION,
  max_threshold DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS measurements (
  id BIGSERIAL PRIMARY KEY,
  sensor_id INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  value DOUBLE PRECISION NOT NULL,
  rssi DOUBLE PRECISION,
  snr DOUBLE PRECISION,
  battery DOUBLE PRECISION,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_measurements_sensor_time ON measurements (sensor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sensors_location ON sensors (location);
