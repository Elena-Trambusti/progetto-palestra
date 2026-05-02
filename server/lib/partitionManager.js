/**
 * Partition Manager - Gestione automatica partizioni PostgreSQL
 * Crea nuove partizioni mensili e archivia/elimina quelle vecchie
 */

const { getPool } = require("./postgresStore");

const DEFAULT_MONTHS_TO_KEEP = Number(process.env.PARTITION_MONTHS_KEEP) || 3;
const ARCHIVE_OLD_DATA = String(process.env.PARTITION_ARCHIVE_OLD || "true").toLowerCase() === "true";

/**
 * Crea partizione per il mese target (se non esiste)
 */
async function createPartitionForMonth(targetDate = new Date()) {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database not configured");
  }

  const year = targetDate.getFullYear();
  const month = targetDate.getMonth() + 1;
  const partitionName = `measurements_${year}_${String(month).padStart(2, "0")}`;
  
  // Calcola date inizio/fine mese
  const startOfMonth = new Date(year, targetDate.getMonth(), 1);
  const endOfMonth = new Date(year, targetDate.getMonth() + 1, 1);
  
  const startIso = startOfMonth.toISOString().split("T")[0];
  const endIso = endOfMonth.toISOString().split("T")[0];

  const client = await pool.connect();
  try {
    // Verifica se partizione esiste
    const checkResult = await client.query(
      `SELECT 1 FROM pg_tables WHERE tablename = $1`,
      [partitionName]
    );
    
    if (checkResult.rows.length > 0) {
      return { created: false, partitionName, message: "Already exists" };
    }

    // Crea partizione
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${partitionName} 
      PARTITION OF measurements 
      FOR VALUES FROM ('${startIso}') TO ('${endIso}')
    `);

    // Crea indici locali
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${partitionName}_sensor_time 
      ON ${partitionName} (sensor_id, timestamp DESC)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${partitionName}_type_time 
      ON ${partitionName} (sensor_type, timestamp DESC)
    `);

    console.log(`[partition] Creata partizione ${partitionName} (${startIso} to ${endIso})`);
    return { created: true, partitionName, startDate: startIso, endDate: endIso };
  } finally {
    client.release();
  }
}

/**
 * Crea partizioni per mese corrente e successivo (idempotent)
 */
async function ensureCurrentPartitions() {
  const results = [];
  const now = new Date();
  
  // Crea partizione mese corrente
  results.push(await createPartitionForMonth(now));
  
  // Crea partizione mese prossimo (per ingest che potrebbe avere timestamp futuri)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  results.push(await createPartitionForMonth(nextMonth));
  
  return results;
}

/**
 * Ottiene lista partizioni esistenti
 */
async function listPartitions() {
  const pool = getPool();
  if (!pool) return [];

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        tablename,
        pg_size_pretty(pg_total_relation_size(tablename::regclass)) as size
      FROM pg_tables 
      WHERE tablename LIKE 'measurements_20%'
      ORDER BY tablename DESC
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Archivia dati da partizioni vecchie in measurements_archive
 */
async function archiveOldPartitions(monthsToKeep = DEFAULT_MONTHS_TO_KEEP) {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database not configured");
  }

  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsToKeep);
  const cutoffPartition = `measurements_${cutoffDate.getFullYear()}_${String(cutoffDate.getMonth() + 1).padStart(2, "0")}`;

  const client = await pool.connect();
  const archived = [];
  
  try {
    // Trova partizioni da archiviare
    const partitionsResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE tablename LIKE 'measurements_20%'
        AND tablename < $1
      ORDER BY tablename
    `, [cutoffPartition]);

    for (const row of partitionsResult.rows) {
      const partitionName = row.tablename;
      
      if (ARCHIVE_OLD_DATA) {
        // Sposta dati in archivio
        const archiveResult = await client.query(`
          INSERT INTO measurements_archive 
          SELECT *, NOW() as archived_at FROM ${partitionName}
        `);
        
        archived.push({
          partition: partitionName,
          rowsArchived: archiveResult.rowCount,
          action: "archived"
        });
        
        console.log(`[partition] Archiviati ${archiveResult.rowCount} righe da ${partitionName}`);
      }
      
      // Elimina partizione
      await client.query(`DROP TABLE IF EXISTS ${partitionName}`);
      console.log(`[partition] Eliminata partizione ${partitionName}`);
    }

    return { archived, dropped: partitionsResult.rows.length };
  } finally {
    client.release();
  }
}

/**
 * Ottiene statistiche sulle partizioni
 */
async function getPartitionStats() {
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    const [partitionsResult, totalRowsResult, archiveResult] = await Promise.all([
      client.query(`
        SELECT 
          tablename,
          pg_total_relation_size(tablename::regclass) as size_bytes
        FROM pg_tables 
        WHERE tablename LIKE 'measurements_20%'
        ORDER BY tablename DESC
      `),
      client.query(`SELECT COUNT(*) as total FROM measurements`),
      client.query(`SELECT COUNT(*) as archived FROM measurements_archive`)
    ]);

    return {
      partitions: partitionsResult.rows,
      totalRows: parseInt(totalRowsResult.rows[0].total),
      archivedRows: parseInt(archiveResult.rows[0].archived),
      totalPartitions: partitionsResult.rows.length
    };
  } finally {
    client.release();
  }
}

/**
 * Job completo: assicura partizioni e pulisce vecchie
 */
async function runPartitionMaintenance() {
  const results = {
    created: [],
    archived: null,
    stats: null
  };
  
  try {
    // Crea partizioni necessarie
    results.created = await ensureCurrentPartitions();
    
    // Archivia/elmina partizioni vecchie
    results.archived = await archiveOldPartitions();
    
    // Ottieni statistiche
    results.stats = await getPartitionStats();
    
    console.log("[partition] Maintenance completato:", {
      partitionsCreated: results.created.filter(r => r.created).length,
      partitionsDropped: results.archived?.dropped || 0,
      rowsArchived: results.archived?.archived?.reduce((sum, a) => sum + (a.rowsArchived || 0), 0) || 0
    });
    
    return results;
  } catch (error) {
    console.error("[partition] Maintenance fallito:", error.message);
    throw error;
  }
}

module.exports = {
  createPartitionForMonth,
  ensureCurrentPartitions,
  listPartitions,
  archiveOldPartitions,
  getPartitionStats,
  runPartitionMaintenance,
  DEFAULT_MONTHS_TO_KEEP
};
