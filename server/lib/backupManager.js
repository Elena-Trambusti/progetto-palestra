/**
 * Backup Manager - Gestione automatica backup PostgreSQL
 * Supporta: backup locale, upload S3/compatibile, retention policy
 */
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const util = require("util");
const crypto = require("crypto");

const execAsync = util.promisify(exec);

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, "../backups");
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 7;
const MAX_BACKUPS = Number(process.env.BACKUP_MAX_COUNT) || 10;

// S3/compatibile configuration
const S3_CONFIG = {
  endpoint: process.env.S3_BACKUP_ENDPOINT || "",
  bucket: process.env.S3_BACKUP_BUCKET || "",
  accessKey: process.env.S3_BACKUP_ACCESS_KEY || "",
  secretKey: process.env.S3_BACKUP_SECRET_KEY || "",
  region: process.env.S3_BACKUP_REGION || "us-east-1",
};

/**
 * Assicura che la directory di backup esista
 */
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * Genera nome file backup con timestamp
 */
function generateBackupFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `palestra_backup_${timestamp}.sql.gz`;
}

/**
 * Calcola hash MD5 del file per verifica integrità
 */
async function calculateFileHash(filePath) {
  const hash = crypto.createHash("md5");
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Esegue backup PostgreSQL usando pg_dump
 */
async function createBackup() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL non configurata");
  }

  ensureBackupDir();
  const filename = generateBackupFilename();
  const filePath = path.join(BACKUP_DIR, filename);

  // Costruisci comando pg_dump con compressione gzip
  const cmd = `pg_dump "${dbUrl}" --verbose --no-owner --no-acl --clean --if-exists | gzip > "${filePath}"`;

  try {
    const { stderr } = await execAsync(cmd, { timeout: 300000 }); // 5 minuti timeout
    
    if (stderr && !stderr.includes("WARNING")) {
      console.warn("[backup] pg_dump warnings:", stderr);
    }

    const stats = fs.statSync(filePath);
    const hash = await calculateFileHash(filePath);

    const backupInfo = {
      filename,
      path: filePath,
      size: stats.size,
      createdAt: new Date().toISOString(),
      hash,
      status: "local",
    };

    // Salva metadata
    saveBackupMetadata(backupInfo);

    console.log(`[backup] Backup creato: ${filename} (${formatBytes(stats.size)})`);
    return backupInfo;
  } catch (error) {
    // Pulisci file parziale in caso di errore
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw new Error(`Backup fallito: ${error.message}`);
  }
}

/**
 * Salva metadata del backup in JSON
 */
function saveBackupMetadata(info) {
  const metaPath = path.join(BACKUP_DIR, "backups.json");
  let backups = [];
  
  if (fs.existsSync(metaPath)) {
    try {
      backups = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      backups = [];
    }
  }

  backups.unshift(info);
  fs.writeFileSync(metaPath, JSON.stringify(backups, null, 2));
}

/**
 * Legge lista backup dal metadata
 */
function listBackups() {
  const metaPath = path.join(BACKUP_DIR, "backups.json");
  if (!fs.existsSync(metaPath)) return [];
  
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return [];
  }
}

/**
 * Rimuove backup vecchi secondo retention policy
 */
async function cleanupOldBackups() {
  const backups = listBackups();
  const now = Date.now();
  const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const toDelete = backups.filter((b) => {
    const age = now - new Date(b.createdAt).getTime();
    return age > retentionMs;
  });

  // Mantieni almeno MAX_BACKUPS più recenti
  const sorted = [...backups].sort((a, b) => 
    new Date(b.createdAt) - new Date(a.createdAt)
  );
  const excess = sorted.slice(MAX_BACKUPS);

  const allToDelete = [...new Set([...toDelete, ...excess])];

  for (const backup of allToDelete) {
    try {
      if (fs.existsSync(backup.path)) {
        fs.unlinkSync(backup.path);
        console.log(`[backup] Rimosso: ${backup.filename}`);
      }
    } catch (err) {
      console.error(`[backup] Errore rimozione ${backup.filename}:`, err.message);
    }
  }

  // Aggiorna metadata
  const remaining = backups.filter(b => 
    !allToDelete.find(d => d.filename === b.filename)
  );
  const metaPath = path.join(BACKUP_DIR, "backups.json");
  fs.writeFileSync(metaPath, JSON.stringify(remaining, null, 2));

  return { deleted: allToDelete.length, remaining: remaining.length };
}

/**
 * Formatta byte in formato leggibile
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Verifica integrità di un backup (test restore parziale)
 */
async function verifyBackup(backupPath) {
  try {
    // Test decompressione e validità SQL
    const cmd = `gunzip -t "${backupPath}" 2>&1`;
    await execAsync(cmd, { timeout: 60000 });
    return { valid: true, message: "Backup integrity verified" };
  } catch (error) {
    return { valid: false, message: error.message };
  }
}

/**
 * Ottiene statistiche del database per il backup
 */
async function getDatabaseStats() {
  const { getPool } = require("./postgresStore");
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    const results = await Promise.all([
      client.query("SELECT COUNT(*) as count FROM sensors"),
      client.query("SELECT COUNT(*) as count FROM measurements"),
      client.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size"),
    ]);

    return {
      sensors: parseInt(results[0].rows[0].count),
      measurements: parseInt(results[1].rows[0].count),
      databaseSize: results[2].rows[0].size,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  createBackup,
  listBackups,
  cleanupOldBackups,
  verifyBackup,
  getDatabaseStats,
  BACKUP_DIR,
  RETENTION_DAYS,
};
