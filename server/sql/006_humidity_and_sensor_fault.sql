-- Migration 006: umidità e stato guasto sensore nelle misure
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS humidity DOUBLE PRECISION;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS sensor_fault VARCHAR(64);
