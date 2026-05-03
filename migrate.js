const { Pool } = require('pg');
const fs = require('fs');

const DATABASE_URL = 'postgresql://dbpalestra_user:Yq2C6vPK8mSUvSXjsZ6MQAT81F138DzP@dpg-d7h9depkh4rs73c1v9q0-a.frankfurt-postgres.render.com/dbpalestra';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const sql = fs.readFileSync('server/sql/003_telemetry_schema.sql', 'utf8');

pool.query(sql)
  .then(() => {
    console.log('✅ Migrazione 003 eseguita con successo!');
    console.log('📊 Colonne battery_level, rssi aggiunte');
    console.log('🔧 Tabella sensor_maintenance_status creata');
    pool.end();
  })
  .catch(err => {
    console.error('❌ Errore migrazione:', err.message);
    pool.end();
    process.exit(1);
  });
