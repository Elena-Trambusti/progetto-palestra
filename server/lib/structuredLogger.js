/**
 * Structured logging per monitoring e debugging
 */

const fs = require('fs');
const path = require('path');

class StructuredLogger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || (process.env.LOG_LEVEL || 'info').toLowerCase();
    this.logFile = options.logFile || path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'app.log');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;

    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };

    this.ensureLogDirectory();
  }

  /**
   * Crea directory log se non esiste
   */
  ensureLogDirectory() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Rotazione log file
   */
  rotateLogFile() {
    try {
      if (!fs.existsSync(this.logFile)) return;

      const stats = fs.statSync(this.logFile);
      if (stats.size < this.maxFileSize) return;

      // Rimuovi file più vecchi
      for (let i = this.maxFiles - 1; i > 0; i--) {
        const oldFile = `${this.logFile}.${i}`;
        const newFile = `${this.logFile}.${i + 1}`;
        
        if (fs.existsSync(oldFile)) {
          if (i === this.maxFiles - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      // Rinomina file corrente
      fs.renameSync(this.logFile, `${this.logFile}.1`);
    } catch (error) {
      console.error('[logger] Errore rotazione log:', error);
    }
  }

  /**
   * Formatta messaggio di log
   */
  formatMessage(level, message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      pid: process.pid,
      hostname: require('os').hostname(),
      ...metadata
    };

    // Aggiungi context aggiuntivo
    if (process.env.RENDER) {
      logEntry.environment = 'render';
      logEntry.service = process.env.RENDER_SERVICE_NAME || 'unknown';
    }

    if (process.env.NODE_ENV) {
      logEntry.nodeEnv = process.env.NODE_ENV;
    }

    return JSON.stringify(logEntry);
  }

  /**
   * Scrive log su file e console
   */
  writeLog(level, message, metadata = {}) {
    if (this.levels[level] > this.levels[this.logLevel]) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message, metadata);

    // Console output
    if (this.enableConsole) {
      const consoleMethod = level === 'error' ? console.error : 
                           level === 'warn' ? console.warn :
                           level === 'debug' ? console.debug :
                           level === 'trace' ? console.trace :
                           console.log;
      
      consoleMethod(`[${level.toUpperCase()}] ${message}`, metadata);
    }

    // File output
    if (this.enableFile) {
      try {
        this.rotateLogFile();
        fs.appendFileSync(this.logFile, formattedMessage + '\n');
      } catch (error) {
        console.error('[logger] Errore scrittura file log:', error);
      }
    }
  }

  /**
   * Metodi di logging
   */
  error(message, metadata = {}) {
    this.writeLog('error', message, metadata);
  }

  warn(message, metadata = {}) {
    this.writeLog('warn', message, metadata);
  }

  info(message, metadata = {}) {
    this.writeLog('info', message, metadata);
  }

  debug(message, metadata = {}) {
    this.writeLog('debug', message, metadata);
  }

  trace(message, metadata = {}) {
    this.writeLog('trace', message, metadata);
  }

  /**
   * Logging specifico per applicazione
   */
  logApiRequest(req, res, responseTime) {
    this.info('API Request', {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      requestId: req.id
    });
  }

  logApiError(req, error, responseTime) {
    this.error('API Error', {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      error: error.message,
      stack: error.stack,
      responseTime: `${responseTime}ms`,
      requestId: req.id
    });
  }

  logSensorData(nodeId, zoneId, sensorData) {
    this.info('Sensor Data Received', {
      nodeId,
      zoneId,
      sensors: Object.keys(sensorData),
      timestamp: new Date().toISOString()
    });
  }

  logSensorError(nodeId, error) {
    this.error('Sensor Data Error', {
      nodeId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }

  logWebSocketConnection(ws, clientId) {
    this.info('WebSocket Connection', {
      clientId,
      userAgent: ws.upgradeReq?.headers['user-agent'],
      ip: ws.upgradeReq?.socket?.remoteAddress
    });
  }

  logWebSocketDisconnection(clientId, reason) {
    this.info('WebSocket Disconnection', {
      clientId,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  logDatabaseQuery(query, duration, error = null) {
    const logData = {
      query: query.substring(0, 200), // Limita lunghezza query
      duration: `${duration}ms`
    };

    if (error) {
      this.error('Database Query Error', {
        ...logData,
        error: error.message
      });
    } else {
      this.debug('Database Query', logData);
    }
  }

  logSystemMetrics(metrics) {
    this.info('System Metrics', {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      ...metrics
    });
  }

  /**
   * Middleware Express per logging richieste
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      req.id = req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        this.logApiRequest(req, res, responseTime);
      });

      res.on('error', (error) => {
        const responseTime = Date.now() - startTime;
        this.logApiError(req, error, responseTime);
      });

      next();
    };
  }

  /**
   * Cleanup vecchi log files
   */
  cleanup() {
    try {
      const logDir = path.dirname(this.logFile);
      const files = fs.readdirSync(logDir)
        .filter(file => file.startsWith(path.basename(this.logFile)) && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(logDir, file),
          mtime: fs.statSync(path.join(logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      // Mantieni solo gli ultimi N files
      if (files.length > this.maxFiles) {
        files.slice(this.maxFiles).forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
    } catch (error) {
      console.error('[logger] Errore cleanup log:', error);
    }
  }
}

// Istanza singleton
const logger = new StructuredLogger();

module.exports = logger;
