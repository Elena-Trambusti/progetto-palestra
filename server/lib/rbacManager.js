/**
 * RBAC Manager - Role-Based Access Control
 * Gestione ruoli, permessi e audit trail
 */

const { getPool } = require("./postgresStore");
const crypto = require("crypto");

// Definizione ruoli e permessi
const ROLES = {
  ADMIN: "admin",
  TECHNICIAN: "technician",
  OPERATOR: "operator",
  VIEWER: "viewer",
};

// Mappatura permessi per ruolo
const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: ["*"], // Admin ha tutti i permessi
  [ROLES.TECHNICIAN]: [
    "sensors:read",
    "sensors:write",
    "sensors:delete",
    "thresholds:read",
    "thresholds:write",
    "dashboard:read",
    "alarms:read",
    "alarms:acknowledge",
    "backup:read",
    "backup:write",
    "partitions:read",
  ],
  [ROLES.OPERATOR]: [
    "sensors:read",
    "dashboard:read",
    "alarms:read",
    "alarms:acknowledge",
  ],
  [ROLES.VIEWER]: ["sensors:read", "dashboard:read", "alarms:read"],
};

/**
 * Verifica se un ruolo ha un permesso specifico
 */
function hasPermission(role, permission) {
  if (!role || !permission) return false;
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.includes("*") || permissions.includes(permission);
}

/**
 * Middleware per verificare permesso specifico
 */
function requirePermission(permission) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole) {
      return res.status(401).json({ error: "authentication_required" });
    }
    if (!hasPermission(userRole, permission)) {
      return res.status(403).json({
        error: "permission_denied",
        required: permission,
        current_role: userRole,
      });
    }
    next();
  };
}

/**
 * Ottiene lista utenti
 */
async function listUsers() {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, username, email, role, is_active, last_login_at, created_at, updated_at
      FROM users
      WHERE is_active = true
      ORDER BY created_at DESC
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Trova utente per username
 */
async function findUserByUsername(username) {
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM users WHERE username = $1 AND is_active = true`,
      [username]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Trova utente per ID
 */
async function findUserById(id) {
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, username, email, role, is_active, last_login_at, created_at
       FROM users WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Crea nuovo utente
 */
async function createUser(
  { username, email, passwordHash, role, createdBy },
  auditContext = {}
) {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");

  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO users (username, email, password_hash, role, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, role, is_active, created_at`,
      [username, email, passwordHash, role, createdBy]
    );

    const user = result.rows[0];

    // Log audit
    await logAudit({
      userId: auditContext.userId,
      userUsername: auditContext.username,
      userRole: auditContext.role,
      action: "create",
      resourceType: "user",
      resourceId: String(user.id),
      details: { new: { username, email, role } },
      ipAddress: auditContext.ip,
      userAgent: auditContext.userAgent,
    });

    return user;
  } finally {
    client.release();
  }
}

/**
 * Aggiorna utente
 */
async function updateUser(
  id,
  { email, role, isActive, passwordHash },
  auditContext = {}
) {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");

  const client = await pool.connect();
  try {
    // Recupera vecchi valori per audit
    const oldUser = await findUserById(id);
    if (!oldUser) return null;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(isActive);
    }
    if (passwordHash) {
      updates.push(`password_hash = $${paramCount++}`);
      values.push(passwordHash);
    }
    updates.push(`updated_at = NOW()`);

    values.push(id);

    const result = await client.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    const newUser = result.rows[0];

    // Log audit
    await logAudit({
      userId: auditContext.userId,
      userUsername: auditContext.username,
      userRole: auditContext.role,
      action: "update",
      resourceType: "user",
      resourceId: String(id),
      details: { old: oldUser, new: newUser },
      ipAddress: auditContext.ip,
      userAgent: auditContext.userAgent,
    });

    return newUser;
  } finally {
    client.release();
  }
}

/**
 * Elimina utente (soft delete)
 */
async function deleteUser(id, auditContext = {}) {
  return updateUser(id, { isActive: false }, auditContext);
}

/**
 * Registra login utente
 */
async function recordLogin(userId, ipAddress) {
  const pool = getPool();
  if (!pool) return;

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
      [userId]
    );
  } finally {
    client.release();
  }
}

/**
 * Scrive entry audit log
 */
async function logAudit({
  userId,
  userUsername,
  userRole,
  action,
  resourceType,
  resourceId,
  details,
  ipAddress,
  userAgent,
  sessionId,
  success = true,
  errorMessage,
}) {
  const pool = getPool();
  if (!pool) return null;

  // Converti IP stringa in formato INET se possibile
  let ipInet = null;
  if (ipAddress) {
    try {
      // Rimuovi IPv6 prefix se presente
      const cleanIp = ipAddress.replace(/^::ffff:/, "");
      ipInet = cleanIp;
    } catch {
      ipInet = null;
    }
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT log_audit($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, $10, $11, $12)`,
      [
        userId,
        userUsername,
        userRole,
        action,
        resourceType,
        resourceId,
        details ? JSON.stringify(details) : null,
        ipInet,
        userAgent,
        sessionId,
        success,
        errorMessage,
      ]
    );
    return result.rows[0]?.log_audit;
  } catch (err) {
    // Non bloccare l'operazione se audit fallisce, solo logga
    console.error("[audit] Failed to write audit log:", err.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Recupera audit logs con filtri
 */
async function getAuditLogs({
  userId,
  action,
  resourceType,
  resourceId,
  fromDate,
  toDate,
  limit = 100,
  offset = 0,
}) {
  const pool = getPool();
  if (!pool) return { logs: [], total: 0 };

  const client = await pool.connect();
  try {
    const conditions = [];
    const values = [];
    let paramCount = 1;

    if (userId) {
      conditions.push(`user_id = $${paramCount++}`);
      values.push(userId);
    }
    if (action) {
      conditions.push(`action = $${paramCount++}`);
      values.push(action);
    }
    if (resourceType) {
      conditions.push(`resource_type = $${paramCount++}`);
      values.push(resourceType);
    }
    if (resourceId) {
      conditions.push(`resource_id = $${paramCount++}`);
      values.push(resourceId);
    }
    if (fromDate) {
      conditions.push(`timestamp >= $${paramCount++}`);
      values.push(fromDate);
    }
    if (toDate) {
      conditions.push(`timestamp <= $${paramCount++}`);
      values.push(toDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Query per i risultati
    const logsResult = await client.query(
      `SELECT * FROM audit_logs ${whereClause} 
       ORDER BY timestamp DESC 
       LIMIT $${paramCount++} OFFSET $${paramCount++}`,
      [...values, limit, offset]
    );

    // Query per il count totale
    const countResult = await client.query(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      values
    );

    return {
      logs: logsResult.rows,
      total: parseInt(countResult.rows[0].total),
    };
  } finally {
    client.release();
  }
}

/**
 * Middleware per estrarre user info da sessione/token
 * Da usare dopo il middleware di autenticazione esistente
 */
function attachUserInfo(req, res, next) {
  // Per ora usa il token come identifier (da migliorare con JWT vero)
  const token = req.get("authorization")?.replace("Bearer ", "") || req.cookies?.palestra_sess;
  
  if (token && req.user) {
    req.auditContext = {
      userId: req.user.id,
      username: req.user.username,
      role: req.user.role,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      sessionId: token,
    };
  }
  
  next();
}

module.exports = {
  ROLES,
  ROLE_PERMISSIONS,
  hasPermission,
  requirePermission,
  listUsers,
  findUserByUsername,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  recordLogin,
  logAudit,
  getAuditLogs,
  attachUserInfo,
};
