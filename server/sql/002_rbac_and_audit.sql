-- ============================================================
-- MIGRATION: RBAC (Role-Based Access Control) e Audit Trail
-- Crea tabella users con ruoli e tabella audit_logs per tracciare
-- tutte le operazioni amministrative.
-- ============================================================

BEGIN;

-- ============================================================
-- TABELLA USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,  -- bcrypt hash
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'
);

-- Ruoli disponibili con descrizione:
-- admin:     Controllo completo, gestione utenti, config sistema
-- technician: Gestione sensori, soglie, manutenzione
-- operator:  Vista dashboard, silenziamento allarmi, readonly sensori
-- viewer:    Solo lettura dashboard, no interazione

CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_active ON users (is_active);

-- ============================================================
-- TABELLA AUDIT_LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_username VARCHAR(50),
    user_role VARCHAR(20),
    action VARCHAR(50) NOT NULL,           -- create, update, delete, login, logout, etc.
    resource_type VARCHAR(50) NOT NULL,    -- sensor, user, setting, backup, etc.
    resource_id VARCHAR(100),                -- ID risorsa modificata (se applicabile)
    details JSONB,                           -- Dettagli operazione (before/after)
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT
) PARTITION BY RANGE (timestamp);

-- Indici principali
CREATE INDEX idx_audit_timestamp ON audit_logs (timestamp DESC);
CREATE INDEX idx_audit_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_action ON audit_logs (action);
CREATE INDEX idx_audit_resource ON audit_logs (resource_type, resource_id);

-- Partizione iniziale per audit_logs (mese corrente)
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    start_date := DATE_TRUNC('month', CURRENT_DATE);
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'audit_logs_' || TO_CHAR(start_date, 'YYYY_MM');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs 
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, 
        TO_CHAR(start_date, 'YYYY-MM-DD'),
        TO_CHAR(end_date, 'YYYY-MM-DD')
    );
END $$;

-- ============================================================
-- FUNZIONI HELPER RBAC
-- ============================================================

-- Verifica se un ruolo ha un permesso specifico
CREATE OR REPLACE FUNCTION has_permission(
    p_role VARCHAR(20),
    p_permission VARCHAR(50)
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- Definizione permessi per ruolo
    RETURN CASE p_role
        WHEN 'admin' THEN true  -- Admin ha tutti i permessi
        WHEN 'technician' THEN p_permission IN (
            'sensors:read', 'sensors:write', 'sensors:delete',
            'thresholds:read', 'thresholds:write',
            'dashboard:read',
            'alarms:read', 'alarms:acknowledge'
        )
        WHEN 'operator' THEN p_permission IN (
            'sensors:read',
            'dashboard:read',
            'alarms:read', 'alarms:acknowledge'
        )
        WHEN 'viewer' THEN p_permission IN (
            'sensors:read',
            'dashboard:read',
            'alarms:read'
        )
        ELSE false
    END;
END;
$$;

-- ============================================================
-- FUNZIONE LOGGING AUDIT
-- ============================================================

CREATE OR REPLACE FUNCTION log_audit(
    p_user_id INTEGER,
    p_user_username VARCHAR(50),
    p_user_role VARCHAR(20),
    p_action VARCHAR(50),
    p_resource_type VARCHAR(50),
    p_resource_id VARCHAR(100) DEFAULT NULL,
    p_details JSONB DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_session_id VARCHAR(255) DEFAULT NULL,
    p_success BOOLEAN DEFAULT true,
    p_error_message TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_log_id BIGINT;
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    -- Assicura che esista la partizione per il mese corrente
    start_date := DATE_TRUNC('month', CURRENT_DATE);
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'audit_logs_' || TO_CHAR(start_date, 'YYYY_MM');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs 
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, 
        TO_CHAR(start_date, 'YYYY-MM-DD'),
        TO_CHAR(end_date, 'YYYY-MM-DD')
    );
    
    -- Inserisce il log
    INSERT INTO audit_logs (
        user_id, user_username, user_role, action, resource_type, resource_id,
        details, ip_address, user_agent, session_id, success, error_message
    ) VALUES (
        p_user_id, p_user_username, p_user_role, p_action, p_resource_type, p_resource_id,
        p_details, p_ip_address, p_user_agent, p_session_id, p_success, p_error_message
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$;

-- ============================================================
-- TRIGGER PER AUDIT AUTOMATICO (opzionale, su tabella sensors)
-- ============================================================

CREATE OR REPLACE FUNCTION audit_sensors_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id INTEGER;
    v_user_username VARCHAR(50);
    v_user_role VARCHAR(20);
    v_details JSONB;
BEGIN
    -- TODO: Recuperare user info da session/context (da implementare in app)
    v_user_id := NULL;
    v_user_username := 'system';
    v_user_role := 'system';
    
    IF TG_OP = 'INSERT' THEN
        v_details := jsonb_build_object('new', row_to_json(NEW));
        PERFORM log_audit(
            v_user_id, v_user_username, v_user_role,
            'create', 'sensor', NEW.id::TEXT, v_details
        );
        RETURN NEW;
        
    ELSIF TG_OP = 'UPDATE' THEN
        v_details := jsonb_build_object('old', row_to_json(OLD), 'new', row_to_json(NEW));
        PERFORM log_audit(
            v_user_id, v_user_username, v_user_role,
            'update', 'sensor', NEW.id::TEXT, v_details
        );
        RETURN NEW;
        
    ELSIF TG_OP = 'DELETE' THEN
        v_details := jsonb_build_object('old', row_to_json(OLD));
        PERFORM log_audit(
            v_user_id, v_user_username, v_user_role,
            'delete', 'sensor', OLD.id::TEXT, v_details
        );
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$;

-- Applica trigger (decommentare se si vuole audit automatico su sensors)
-- DROP TRIGGER IF EXISTS sensors_audit_trigger ON sensors;
-- CREATE TRIGGER sensors_audit_trigger
--     AFTER INSERT OR UPDATE OR DELETE ON sensors
--     FOR EACH ROW EXECUTE FUNCTION audit_sensors_trigger();

-- ============================================================
-- UTENTE ADMIN DEFAULT (password: changeme)
-- Hash bcrypt per "changeme" (rounds 10)
-- ============================================================

INSERT INTO users (username, email, password_hash, role, is_active, created_by)
VALUES (
    'admin',
    'admin@palestra.local',
    '$2b$10$YourHashHere.Change.In.Production',  -- Placeholder, va rigenerato
    'admin',
    true,
    NULL
)
ON CONFLICT (username) DO NOTHING;

COMMIT;

-- ============================================================
-- VISTE UTILI
-- ============================================================

-- Vista riassuntiva azioni per utente
CREATE OR REPLACE VIEW audit_summary_by_user AS
SELECT 
    user_id,
    user_username,
    user_role,
    action,
    resource_type,
    COUNT(*) as action_count,
    MIN(timestamp) as first_action,
    MAX(timestamp) as last_action
FROM audit_logs
GROUP BY user_id, user_username, user_role, action, resource_type;

-- Vista permessi per ruolo
CREATE OR REPLACE VIEW role_permissions AS
SELECT 
    'admin' as role, unnest(ARRAY[
        '*'
    ]) as permission
UNION ALL
SELECT 
    'technician', unnest(ARRAY[
        'sensors:read', 'sensors:write', 'sensors:delete',
        'thresholds:read', 'thresholds:write',
        'dashboard:read',
        'alarms:read', 'alarms:acknowledge'
    ])
UNION ALL
SELECT 
    'operator', unnest(ARRAY[
        'sensors:read',
        'dashboard:read',
        'alarms:read', 'alarms:acknowledge'
    ])
UNION ALL
SELECT 
    'viewer', unnest(ARRAY[
        'sensors:read',
        'dashboard:read',
        'alarms:read'
    ]);
