/**
 * Cache API con TTL e strategie di invalidazione
 */

class ApiCache {
  constructor(defaultTTL = 30000) { // 30 secondi default
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
    this.timers = new Map();
  }

  /**
   * Genera chiave cache da URL e parametri
   */
  generateKey(url, params = {}) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
    return `${url}${sortedParams ? `?${sortedParams}` : ''}`;
  }

  /**
   * Salva dati in cache con TTL
   */
  set(key, data, ttl = this.defaultTTL) {
    // Pulisci timer esistente
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    // Salva dati
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });

    // Imposta timer per rimozione automatica
    const timer = setTimeout(() => {
      this.delete(key);
    }, ttl);
    this.timers.set(key, timer);
  }

  /**
   * Recupera dati dalla cache
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    // Verifica TTL
    if (Date.now() - item.timestamp > item.ttl) {
      this.delete(key);
      return null;
    }

    return item.data;
  }

  /**
   * Elimina entry dalla cache
   */
  delete(key) {
    this.cache.delete(key);
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }

  /**
   * Svuota tutta la cache
   */
  clear() {
    // Pulisci tutti i timer
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.cache.clear();
  }

  /**
   * Invalida cache per pattern
   */
  invalidatePattern(pattern) {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.delete(key);
      }
    }
  }

  /**
   * Statistiche cache
   */
  getStats() {
    return {
      size: this.cache.size,
      timers: this.timers.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Istanza singleton
const apiCache = new ApiCache();

/**
 * Wrapper fetch con cache
 */
export async function cachedFetch(url, options = {}, ttl = null) {
  const cacheKey = apiCache.generateKey(url, options.params || {});
  
  // Try cache first for GET requests
  if (!options.method || options.method === 'GET') {
    const cached = apiCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Fetch actual data
  const response = await fetch(url, options);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Cache GET requests
  if (!options.method || options.method === 'GET') {
    apiCache.set(cacheKey, data, ttl);
  }

  return data;
}

/**
 * Hook React per cache API
 */
export function useApiCache() {
  const invalidatePattern = (pattern) => {
    apiCache.invalidatePattern(pattern);
  };

  const clearCache = () => {
    apiCache.clear();
  };

  const getStats = () => {
    return apiCache.getStats();
  };

  return {
    invalidatePattern,
    clearCache,
    getStats
  };
}

export default apiCache;
