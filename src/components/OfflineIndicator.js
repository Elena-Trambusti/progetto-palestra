/**
 * Componente indicatore stato connessione e cache offline
 */

import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Database, AlertTriangle } from 'lucide-react';
import { useOfflineCache, useConnectionStatus } from '../services/offlineCache';
import './OfflineIndicator.css';

export default function OfflineIndicator() {
  const { isOnline, connectionType, isSlowConnection } = useConnectionStatus();
  const { stats } = useOfflineCache();
  const [showDetails, setShowDetails] = useState(false);
  const [cacheStats, setCacheStats] = useState(null);

  useEffect(() => {
    if (showDetails) {
      setCacheStats(stats());
    }
  }, [showDetails, stats]);

  if (isOnline && !isSlowConnection) {
    return null; // Non mostrare se tutto è normale
  }

  const getStatusIcon = () => {
    if (!isOnline) return <WifiOff size={16} />;
    if (isSlowConnection) return <AlertTriangle size={16} />;
    return <Wifi size={16} />;
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSlowConnection) return 'Connessione lenta';
    return 'Online';
  };

  const getStatusClass = () => {
    if (!isOnline) return 'offline-indicator--offline';
    if (isSlowConnection) return 'offline-indicator--slow';
    return 'offline-indicator--online';
  };

  return (
    <div className={`offline-indicator ${getStatusClass()}`}>
      <button
        className="offline-indicator__button"
        onClick={() => setShowDetails(!showDetails)}
        title={`Stato: ${getStatusText()} - Tipo: ${connectionType}`}
      >
        {getStatusIcon()}
        <span className="offline-indicator__text">{getStatusText()}</span>
        {cacheStats && cacheStats.totalEntries > 0 && (
          <Database size={14} className="offline-indicator__cache-icon" />
        )}
      </button>

      {showDetails && (
        <div className="offline-indicator__details">
          <div className="offline-indicator__detail-row">
            <strong>Connessione:</strong> {getStatusText()}
          </div>
          <div className="offline-indicator__detail-row">
            <strong>Tipo:</strong> {connectionType}
          </div>
          {cacheStats && (
            <>
              <div className="offline-indicator__detail-row">
                <strong>Cache locale:</strong> {cacheStats.totalEntries} elementi
              </div>
              <div className="offline-indicator__detail-row">
                <strong>Dimensione:</strong> {(cacheStats.totalSize / 1024).toFixed(1)} KB
              </div>
              {cacheStats.expiredEntries > 0 && (
                <div className="offline-indicator__detail-row offline-indicator__warning">
                  <strong>Scaduti:</strong> {cacheStats.expiredEntries} elementi
                </div>
              )}
            </>
          )}
          {!isOnline && (
            <div className="offline-indicator__detail-row offline-indicator__warning">
              <strong>Attenzione:</strong> Dati visualizzati dalla cache locale
            </div>
          )}
        </div>
      )}
    </div>
  );
}
