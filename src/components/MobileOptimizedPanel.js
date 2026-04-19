/**
 * Componente panel ottimizzato per mobile
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';
import './MobileOptimizedPanel.css';

export default function MobileOptimizedPanel({ 
  title, 
  children, 
  defaultExpanded = true,
  collapsible = true,
  className = '',
  headerActions = null
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleExpanded = () => {
    if (collapsible) {
      setIsExpanded(!isExpanded);
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div 
      className={`mobile-optimized-panel ${isExpanded ? 'expanded' : 'collapsed'} ${isFullscreen ? 'fullscreen' : ''} ${className}`}
    >
      <div className="mobile-optimized-panel__header">
        <div className="mobile-optimized-panel__title-section">
          {collapsible && (
            <button 
              className="mobile-optimized-panel__toggle"
              onClick={toggleExpanded}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
          <h3 className="mobile-optimized-panel__title">{title}</h3>
        </div>
        
        <div className="mobile-optimized-panel__actions">
          {headerActions}
          <button 
            className="mobile-optimized-panel__fullscreen"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Esci da schermo intero" : "Schermo intero"}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
      
      {isExpanded && (
        <div className="mobile-optimized-panel__content">
          {children}
        </div>
      )}
    </div>
  );
}
