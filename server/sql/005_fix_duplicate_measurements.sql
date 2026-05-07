-- Migrazione 005: Aggiunta f_cnt e indice di deduplicazione
-- Previene il salvataggio di pacchetti identici in caso di riavvio server

-- 1. Aggiungi colonna f_cnt (Frame Counter) alla tabella measurements
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS f_cnt INTEGER;

-- 2. Pulizia dati pre-esistenti: elimina duplicati esatti per evitare fallimento indice UNIQUE
-- Mantiene solo la riga con ID minore per ogni gruppo di (sensor_id, timestamp, f_cnt)
DELETE FROM measurements a 
USING measurements b 
WHERE a.id > b.id 
  AND a.sensor_id = b.sensor_id 
  AND a.timestamp = b.timestamp 
  AND COALESCE(a.f_cnt, 0) = COALESCE(b.f_cnt, 0);

-- 3. Crea indice UNIQUE per deduplicazione atomica (Functional Index)
-- Nota: Usiamo COALESCE per gestire pacchetti senza f_cnt
CREATE UNIQUE INDEX IF NOT EXISTS idx_measurements_deduplication 
ON measurements (sensor_id, timestamp, (COALESCE(f_cnt, 0)));
