-- ============================================================
-- MIGRATION: Partizionamento tabella measurements per mese
-- Questo script converte la tabella measurements in una 
-- tabella partizionata per range temporale (mensile)
-- ============================================================

-- NOTA: Eseguire durante manutenzione programmata (blocca scritture)

BEGIN;

-- 1. Rinomina tabella esistente
ALTER TABLE measurements RENAME TO measurements_old;

-- 2. Ricrea indici della tabella vecchia per performance migrazione
CREATE INDEX IF NOT EXISTS idx_measurements_old_sensor_time 
    ON measurements_old (sensor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_old_type_time 
    ON measurements_old (sensor_type, timestamp DESC);

-- 3. Crea nuova tabella partizionata
CREATE TABLE measurements (
    id BIGSERIAL,
    sensor_id INTEGER NOT NULL,
    sensor_type VARCHAR(50) NOT NULL,
    dev_eui VARCHAR(16),
    timestamp TIMESTAMPTZ NOT NULL,
    temperature NUMERIC(5,2),
    humidity NUMERIC(5,2),
    pressure NUMERIC(8,2),
    co2 INTEGER,
    voc INTEGER,
    lux INTEGER,
    rssi INTEGER,
    snr NUMERIC(5,2),
    battery INTEGER,
    water_level_mm INTEGER,
    flow_lpm NUMERIC(6,3),
    total_liters NUMERIC(12,3),
    gateway_id VARCHAR(50),
    node_id VARCHAR(50),
    zone_id VARCHAR(50),
    location VARCHAR(100),
    extra JSONB,
    PRIMARY KEY (id, timestamp)  -- timestamp deve essere parte della PK per partizionamento
) PARTITION BY RANGE (timestamp);

-- 4. Crea partizioni iniziali (ultimi 3 mesi + corrente + 1 futura)
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
    start_iso TEXT;
    end_iso TEXT;
BEGIN
    -- Crea partizioni per 3 mesi precedenti, corrente, e 1 mese futuro
    FOR i IN -3..1 LOOP
        start_date := DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'measurements_' || TO_CHAR(start_date, 'YYYY_MM');
        start_iso := TO_CHAR(start_date, 'YYYY-MM-DD');
        end_iso := TO_CHAR(end_date, 'YYYY-MM-DD');
        
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF measurements 
             FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_iso, end_iso
        );
        
        -- Crea indici locali su ogni partizione
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_%s_sensor_time ON %I (sensor_id, timestamp DESC)',
            partition_name, partition_name
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_%s_type_time ON %I (sensor_type, timestamp DESC)',
            partition_name, partition_name
        );
        
        RAISE NOTICE 'Creata partizione % da % a %', partition_name, start_iso, end_iso;
    END LOOP;
END $$;

-- 5. Migra dati dalla tabella vecchia alle partizioni
-- Nota: su grandi dataset, fare in batch
INSERT INTO measurements 
SELECT * FROM measurements_old
WHERE timestamp >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months');

-- 6. Crea funzione per creare partizioni automaticamente
CREATE OR REPLACE FUNCTION create_monthly_partition(
    target_date DATE DEFAULT CURRENT_DATE
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    start_date := DATE_TRUNC('month', target_date);
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'measurements_' || TO_CHAR(start_date, 'YYYY_MM');
    
    -- Crea partizione se non esiste
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF measurements 
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, 
        TO_CHAR(start_date, 'YYYY-MM-DD'),
        TO_CHAR(end_date, 'YYYY-MM-DD')
    );
    
    -- Crea indici sulla nuova partizione
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%s_sensor_time ON %I (sensor_id, timestamp DESC)',
        partition_name, partition_name
    );
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%s_type_time ON %I (sensor_type, timestamp DESC)',
        partition_name, partition_name
    );
    
    RETURN partition_name;
END;
$$;

-- 7. Crea funzione per eliminare partizioni vecchie (archiviazione)
CREATE OR REPLACE FUNCTION drop_old_partitions(
    months_to_keep INTEGER DEFAULT 3
) RETURNS TABLE(dropped_partition TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    cutoff_date DATE;
    partition_record RECORD;
BEGIN
    cutoff_date := DATE_TRUNC('month', CURRENT_DATE - (months_to_keep || ' months')::INTERVAL);
    
    FOR partition_record IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'measurements_20%'
          AND tablename < 'measurements_' || TO_CHAR(cutoff_date, 'YYYY_MM')
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I', partition_record.tablename);
        dropped_partition := partition_record.tablename;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- 8. Crea tabella per archiviazione (dati storici compressi)
CREATE TABLE IF NOT EXISTS measurements_archive (
    id BIGINT,
    sensor_id INTEGER,
    sensor_type VARCHAR(50),
    dev_eui VARCHAR(16),
    timestamp TIMESTAMPTZ,
    temperature NUMERIC(5,2),
    humidity NUMERIC(5,2),
    pressure NUMERIC(8,2),
    co2 INTEGER,
    voc INTEGER,
    lux INTEGER,
    rssi INTEGER,
    snr NUMERIC(5,2),
    battery INTEGER,
    water_level_mm INTEGER,
    flow_lpm NUMERIC(6,3),
    total_liters NUMERIC(12,3),
    gateway_id VARCHAR(50),
    node_id VARCHAR(50),
    zone_id VARCHAR(50),
    location VARCHAR(100),
    archived_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_archive_timestamp ON measurements_archive (timestamp DESC);
CREATE INDEX idx_archive_sensor ON measurements_archive (sensor_id);

-- 9. Crea funzione per archiviare dati vecchi (invece di eliminarli)
CREATE OR REPLACE FUNCTION archive_old_data(
    months_to_archive INTEGER DEFAULT 3
) RETURNS TABLE(archived_rows BIGINT, partition_name TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    cutoff_date DATE;
    partition_record RECORD;
    row_count BIGINT;
BEGIN
    cutoff_date := DATE_TRUNC('month', CURRENT_DATE - (months_to_archive || ' months')::INTERVAL);
    
    FOR partition_record IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'measurements_20%'
          AND tablename < 'measurements_' || TO_CHAR(cutoff_date, 'YYYY_MM')
    LOOP
        -- Sposta dati in archivio
        EXECUTE format(
            'INSERT INTO measurements_archive 
             SELECT *, NOW() FROM %I',
            partition_record.tablename
        );
        
        GET DIAGNOSTICS row_count = ROW_COUNT;
        archived_rows := row_count;
        partition_name := partition_record.tablename;
        
        -- Elimina partizione
        EXECUTE format('DROP TABLE IF EXISTS %I', partition_record.tablename);
        
        RETURN NEXT;
    END LOOP;
END;
$$;

COMMIT;

-- 10. Statistiche post-migrazione
SELECT 
    'Partizioni attive' as info, 
    COUNT(*) as count 
FROM pg_tables 
WHERE tablename LIKE 'measurements_20%';

SELECT 
    'Righe migrate (ultimi 3 mesi)' as info,
    COUNT(*) as count 
FROM measurements;

SELECT 
    'Righe totali (storico)' as info,
    COUNT(*) as count 
FROM measurements_old;
