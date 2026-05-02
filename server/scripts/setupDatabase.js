#!/usr/bin/env node
/**
 * Script setup automatico database
 * Esegue migration SQL e crea utente admin iniziale
 * 
 * Uso:
 *   node server/scripts/setupDatabase.js
 *   npm run db:setup
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[setup] ERRORE: DATABASE_URL non configurato');
  console.error('[setup] Impostare DATABASE_URL nel file .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
});

const MIGRATIONS_DIR = path.join(__dirname, '..', 'sql');

async function createMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(client) {
  const result = await client.query('SELECT filename FROM migrations ORDER BY executed_at');
  return new Set(result.rows.map(r => r.filename));
}

async function executeMigration(client, filename, sql) {
  console.log(`[setup] Eseguendo migration: ${filename}`);
  
  // Esegui SQL
  await client.query(sql);
  
  // Registra migration
  await client.query(
    'INSERT INTO migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
    [filename]
  );
  
  console.log(`[setup] ✓ Migration completata: ${filename}`);
}

async function createInitialAdmin(client) {
  // Verifica se esiste già un admin
  const result = await client.query(`
    SELECT id FROM users WHERE role = 'admin' LIMIT 1
  `).catch(() => null);
  
  if (result && result.rows.length > 0) {
    console.log('[setup] ℹ Utente admin esistente, skip creazione');
    return;
  }
  
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'changeme123';
  
  // Hash semplice (in produzione usare bcrypt)
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(adminPassword).digest('hex');
  
  await client.query(`
    INSERT INTO users (username, password_hash, role, email, is_active)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (username) DO NOTHING
  `, ['admin', hash, 'admin', 'admin@palestra.local', true]);
  
  console.log('[setup] ✓ Utente admin creato (username: admin)');
  console.log('[setup] ⚠ Cambiare password di default dopo primo login!');
}

async function setup() {
  console.log('[setup] Inizio setup database...');
  
  const client = await pool.connect();
  
  try {
    // Crea tabella migration tracking
    await createMigrationsTable(client);
    
    // Trova migration da eseguire
    const executed = await getExecutedMigrations(client);
    
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    console.log(`[setup] Trovate ${migrationFiles.length} migration`);
    
    for (const filename of migrationFiles) {
      if (executed.has(filename)) {
        console.log(`[setup] ✓ Già eseguita: ${filename}`);
        continue;
      }
      
      const filepath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filepath, 'utf8');
      
      await executeMigration(client, filename, sql);
    }
    
    // Crea admin iniziale (se migration 002 presente)
    if (migrationFiles.includes('002_rbac_and_audit.sql')) {
      await createInitialAdmin(client);
    }
    
    console.log('[setup] ✓ Setup completato con successo!');
    
  } catch (err) {
    console.error('[setup] ERRORE:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Se eseguito direttamente
if (require.main === module) {
  setup();
}

module.exports = { setup };
