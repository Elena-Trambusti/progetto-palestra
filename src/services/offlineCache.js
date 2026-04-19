/**
 * Cache locale per gestione stato offline
 */

import { useState, useEffect } from 'react';

const OFFLINE_CACHE_KEY = 'palestra_offline_cache';
const OFFLINE_CACHE_VERSION = '1.0';
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 ore

class OfflineCache {
  constructor() {
    this.cache = this.loadCache();
    this.cleanupExpired();
  }

  /**
   * Carica cache da localStorage
   */
  loadCache() {
    try {
      const stored = localStorage.getItem(OFFLINE_CACHE_KEY);
      if (!stored) return { data: {}, metadata: { version: OFFLINE_CACHE_VERSION } };
      
      const parsed = JSON.parse(stored);
      if (parsed.metadata?.version !== OFFLINE_CACHE_VERSION) {
        this.clearCache();
        return { data: {}, metadata: { version: OFFLINE_CACHE_VERSION } };
      }
      
      return parsed;
    } catch (error) {
      console.warn('[offline-cache] Errore caricamento cache:', error);
      return { data: {}, metadata: { version: OFFLINE_CACHE_VERSION } };
    }
  }

  /**
   * Salva cache in localStorage
   */
  saveCache() {
    try {
      const serialized = JSON.stringify(this.cache);
      
      // Verifica dimensione
      if (serialized.length > MAX_CACHE_SIZE) {
        this.evictOldest();
        return this.saveCache(); // Retry dopo cleanup
      }
      
      localStorage.setItem(OFFLINE_CACHE_KEY, serialized);
    } catch (error) {
      console.warn('[offline-cache] Errore salvataggio cache:', error);
      if (error.name === 'QuotaExceededError') {
        this.evictOldest();
        return this.saveCache(); // Retry dopo cleanup
      }
    }
  }

  /**
   * Pulisce entry scadute
   */
  cleanupExpired() {
    const now = Date.now();
    let hasChanges = false;

    for (const [key, entry] of Object.entries(this.cache.data)) {
      if (entry.expiresAt && entry.expiresAt < now) {
        delete this.cache.data[key];
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.saveCache();
    }
  }

  /**
   * Rimuove entry più vecchie
   */
  evictOldest() {
    const entries = Object.entries(this.cache.data);
    if (entries.length === 0) return;

    // Ordina per timestamp e rimuovi il 20% più vecchio
    entries.sort(([, a], [, b]) => a.timestamp - b.timestamp);
    const toRemove = Math.ceil(entries.length * 0.2);
    
    for (let i = 0; i < toRemove; i++) {
      delete this.cache.data[entries[i][0]];
    }
  }

  /**
   * Salva dati con TTL
   */
  set(key, data, ttl = DEFAULT_TTL) {
    const entry = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
      ttl
    };

    this.cache.data[key] = entry;
    this.saveCache();
  }

  /**
   * Recupera dati dalla cache
   */
  get(key) {
    const entry = this.cache.data[key];
    if (!entry) return null;

    // Verifica scadenza
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      delete this.cache.data[key];
      this.saveCache();
      return null;
    }

    return entry.data;
  }

  /**
   * Verifica se esiste entry valida
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Elimina entry specifica
   */
  delete(key) {
    if (this.cache.data[key]) {
      delete this.cache.data[key];
      this.saveCache();
    }
  }

  /**
   * Svuota tutta la cache
   */
  clearCache() {
    this.cache = { data: {}, metadata: { version: OFFLINE_CACHE_VERSION } };
    try {
      localStorage.removeItem(OFFLINE_CACHE_KEY);
    } catch (error) {
      console.warn('[offline-cache] Errore pulizia cache:', error);
    }
  }

  /**
   * Statistiche cache
   */
  getStats() {
    const entries = Object.values(this.cache.data);
    const now = Date.now();
    
    return {
      totalEntries: entries.length,
      expiredEntries: entries.filter(e => e.expiresAt && e.expiresAt < now).length,
      totalSize: JSON.stringify(this.cache).length,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : null,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.timestamp)) : null
    };
  }

  /**
   * Lista chiavi cache
   */
  getKeys() {
    return Object.keys(this.cache.data);
  }
}

// Istanza singleton
const offlineCache = new OfflineCache();

/**
 * Hook React per cache offline
 */
export function useOfflineCache() {
  const get = (key) => offlineCache.get(key);
  const set = (key, data, ttl) => offlineCache.set(key, data, ttl);
  const has = (key) => offlineCache.has(key);
  const remove = (key) => offlineCache.delete(key);
  const clear = () => offlineCache.clearCache();
  const stats = () => offlineCache.getStats();
  const keys = () => offlineCache.getKeys();

  return {
    get,
    set,
    has,
    remove,
    clear,
    stats,
    keys
  };
}

/**
 * Detector stato connessione
 */
export function useConnectionStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [connectionType, setConnectionType] = useState('unknown');

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const updateConnectionType = () => {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection) {
        setConnectionType(connection.effectiveType || 'unknown');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    if (navigator.connection) {
      navigator.connection.addEventListener('change', updateConnectionType);
      updateConnectionType();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (navigator.connection) {
        navigator.connection.removeEventListener('change', updateConnectionType);
      }
    };
  }, []);

  return {
    isOnline,
    connectionType,
    isSlowConnection: ['slow-2g', '2g'].includes(connectionType)
  };
}

export default offlineCache;
