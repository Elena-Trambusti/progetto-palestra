/**
 * Hook React per lazy loading di componenti pesanti
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hook per lazy loading con Intersection Observer
 */
export function useLazyLoad(threshold = 0.1, rootMargin = '50px') {
  const [hasLoaded, setHasLoaded] = useState(false);
  const elementRef = useRef(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasLoaded(true);
          observer.unobserve(element);
        }
      },
      {
        threshold,
        rootMargin
      }
    );

    observer.observe(element);

    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, [threshold, rootMargin]);

  return {
    ref: elementRef,
    hasLoaded
  };
}

/**
 * Componente wrapper per lazy loading
 */
export function LazyWrapper({ 
  children, 
  fallback = null, 
  threshold = 0.1, 
  rootMargin = '50px',
  className = ''
}) {
  const { ref, hasLoaded } = useLazyLoad(threshold, rootMargin);

  return (
    <div ref={ref} className={className}>
      {hasLoaded ? children : fallback}
    </div>
  );
}

/**
 * Hook per lazy loading di immagini
 */
export function useLazyImage(src, placeholder = null) {
  const [imageSrc, setImageSrc] = useState(placeholder);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const imgRef = useRef(null);

  useEffect(() => {
    if (!src) return;

    const img = new Image();
    img.src = src;

    img.onload = () => {
      setImageSrc(src);
      setIsLoading(false);
      setError(null);
    };

    img.onerror = () => {
      setError(new Error(`Failed to load image: ${src}`));
      setIsLoading(false);
    };

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, placeholder]);

  return {
    ref: imgRef,
    src: imageSrc,
    isLoading,
    error
  };
}

/**
 * Hook per virtual scrolling (per liste lunghe)
 */
export function useVirtualScroll({
  items = [],
  itemHeight = 50,
  containerHeight = 400,
  overscan = 5
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef(null);

  const visibleStart = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleEnd = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(visibleStart, visibleEnd + 1).map((item, index) => ({
    item,
    index: visibleStart + index,
    top: (visibleStart + index) * itemHeight
  }));

  const totalHeight = items.length * itemHeight;

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  return {
    containerRef,
    visibleItems,
    totalHeight,
    handleScroll,
    containerProps: {
      ref: containerRef,
      onScroll: handleScroll,
      style: {
        height: containerHeight,
        overflow: 'auto'
      }
    }
  };
}

/**
 * Hook per debounced loading
 */
export function useDebouncedLoad(callback, delay = 300) {
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef(null);

  const debouncedCallback = useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setIsLoading(true);
    timeoutRef.current = setTimeout(async () => {
      try {
        await callback(...args);
      } finally {
        setIsLoading(false);
      }
    }, delay);
  }, [callback, delay]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    load: debouncedCallback,
    isLoading
  };
}

const lazyLoadHooks = {
  useLazyLoad,
  LazyWrapper,
  useLazyImage,
  useVirtualScroll,
  useDebouncedLoad
};

export default lazyLoadHooks;
