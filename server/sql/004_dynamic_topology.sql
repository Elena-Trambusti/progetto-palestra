-- Migration 004: Topology Dynamization
-- Moves hardcoded zonesData.js into the database for 100% modularity

CREATE TABLE IF NOT EXISTS floors (
  id VARCHAR(32) PRIMARY KEY,
  label VARCHAR(128) NOT NULL,
  plan_slug VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gateways (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  floor_id VARCHAR(32) REFERENCES floors(id) ON DELETE SET NULL,
  map_x DOUBLE PRECISION,
  map_y DOUBLE PRECISION,
  location VARCHAR(128),
  uplink VARCHAR(64),
  backhaul VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zones (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  floor_id VARCHAR(32) REFERENCES floors(id) ON DELETE SET NULL,
  map_x DOUBLE PRECISION,
  map_y DOUBLE PRECISION,
  kind VARCHAR(64),
  primary_node_id VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add topology columns to sensors (nodes)
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS zone_id VARCHAR(64) REFERENCES zones(id) ON DELETE SET NULL;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS gateway_id VARCHAR(64) REFERENCES gateways(id) ON DELETE SET NULL;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS floor_id VARCHAR(32) REFERENCES floors(id) ON DELETE SET NULL;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS map_x DOUBLE PRECISION;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS map_y DOUBLE PRECISION;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS hardware VARCHAR(128);
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS sensor_list JSONB DEFAULT '[]'::jsonb;

-- Populate initial data if empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM floors) THEN
    INSERT INTO floors (id, label, plan_slug) VALUES
      ('0', 'Piano 0 (Vano Idrico)', '0'),
      ('1', 'Piano 1 (Palestra)', '1'),
      ('2', 'Piano 2 (Tetto)', '2');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM gateways) THEN
    INSERT INTO gateways (id, name, floor_id, map_x, map_y, location, uplink, backhaul) VALUES
      ('gw-livorno-01', 'Gateway LoRa centrale', '2', 50, 50, 'Tetto', 'LoRa', 'Ethernet');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM zones) THEN
    INSERT INTO zones (id, name, floor_id, map_x, map_y, kind, primary_node_id) VALUES
      ('vano-idrico', 'Vano Idrico', '0', 20, 20, 'water', 'node-water-01'),
      ('palestra', 'Palestra', '1', 50, 50, 'environment', 'node-env-01'),
      ('controsoffitti', 'Controsoffitti Palestra', '1', 50, 20, 'technical', 'node-tech-01'),
      ('tetto', 'Tetto', '2', 50, 50, 'gateway', 'gw-livorno-01');
  END IF;
  
  -- We assume sensors table might already have entries, we update them to map to new topology
  UPDATE sensors SET zone_id = 'vano-idrico', gateway_id = 'gw-livorno-01', floor_id = '0', map_x = 20, map_y = 20, hardware = 'ESP32 + LoRa', sensor_list = '["flowLmin", "levelPercent", "temperatureC"]'::jsonb WHERE dev_eui = 'node-water-01';
  UPDATE sensors SET zone_id = 'palestra', gateway_id = 'gw-livorno-01', floor_id = '1', map_x = 50, map_y = 50, hardware = 'STM32 + LoRa', sensor_list = '["temperatureC", "co2Ppm", "vocIndex"]'::jsonb WHERE dev_eui = 'node-env-01';
  UPDATE sensors SET zone_id = 'controsoffitti', gateway_id = 'gw-livorno-01', floor_id = '1', map_x = 50, map_y = 20, hardware = 'ESP32 + LoRa', sensor_list = '["water_level_mm", "battery", "rssi"]'::jsonb WHERE dev_eui = 'node-tech-01';
  
END $$;
