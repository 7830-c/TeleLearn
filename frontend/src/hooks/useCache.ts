import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface UseCacheOptions {
  /** Time-to-live in ms before data is considered stale (default: 5 min) */
  ttl?: number;
  /** If true, skip fetching entirely (useful for conditional queries) */
  skip?: boolean;
  /** If true, don't serve stale data — wait for fresh */
  noStale?: boolean;
}

interface UseCacheResult<T> {
  data: T | null;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const CACHE_PREFIX = 'tl_cache_';

// In-memory cache for faster access than localStorage
const memoryCache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): CacheEntry<T> | null {
  // Check memory first
  const mem = memoryCache.get(key);
  if (mem) return mem;

  // Fall back to localStorage
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry<T>;
      memoryCache.set(key, entry);
      return entry;
    }
  } catch {
    // Corrupted entry — remove it
    localStorage.removeItem(CACHE_PREFIX + key);
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  memoryCache.set(key, entry);
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full — clear old entries
    clearOldEntries();
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Still full — just use memory
    }
  }
}

function clearOldEntries(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  // Sort by timestamp, remove oldest half
  const entries = keys.map(k => {
    try {
      const e = JSON.parse(localStorage.getItem(k) || '{}');
      return { key: k, ts: e.timestamp || 0 };
    } catch {
      return { key: k, ts: 0 };
    }
  }).sort((a, b) => a.ts - b.ts);
  
  const toRemove = Math.ceil(entries.length / 2);
  for (let i = 0; i < toRemove; i++) {
    localStorage.removeItem(entries[i].key);
    memoryCache.delete(entries[i].key.replace(CACHE_PREFIX, ''));
  }
}

/** Invalidate cache entries matching a pattern */
export function invalidateCache(pattern: string): void {
  // Memory cache
  for (const key of memoryCache.keys()) {
    if (key.includes(pattern)) memoryCache.delete(key);
  }
  // localStorage
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX) && key.includes(pattern)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}

/** Invalidate ALL cache */
export function invalidateAllCache(): void {
  memoryCache.clear();
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}

/**
 * SWR-style data fetching hook.
 * Instantly serves stale data from cache, then revalidates in the background.
 */
export function useCache<T = any>(
  url: string | null,
  options: UseCacheOptions = {}
): UseCacheResult<T> {
  const { ttl = 5 * 60 * 1000, skip = false, noStale = false } = options;
  
  const [data, setData] = useState<T | null>(() => {
    if (skip || !url) return null;
    const cached = getCached<T>(url);
    return (!noStale && cached) ? cached.data : null;
  });
  const [isLoading, setIsLoading] = useState(!data);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const urlRef = useRef(url);
  urlRef.current = url;

  const fetchData = useCallback(async () => {
    const currentUrl = urlRef.current;
    if (!currentUrl || skip) return;

    try {
      setError(null);
      const res = await api.get(currentUrl, {
        // Bypass any old request interceptor cache
        headers: { 'x-no-cache': '1' }
      });
      
      // Only update if the URL hasn't changed while we were fetching
      if (urlRef.current === currentUrl) {
        setData(res.data);
        setIsStale(false);
        setIsLoading(false);
        setCache(currentUrl, res.data);
      }
    } catch (err: any) {
      if (urlRef.current === currentUrl) {
        setError(err.message || 'Failed to fetch');
        setIsLoading(false);
      }
    }
  }, [skip]);

  useEffect(() => {
    if (skip || !url) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const cached = getCached<T>(url);
    
    if (cached && !noStale) {
      // Serve stale data instantly
      setData(cached.data);
      setIsLoading(false);
      
      const age = Date.now() - cached.timestamp;
      if (age > ttl) {
        // Data is stale — revalidate in background
        setIsStale(true);
        fetchData();
      } else {
        setIsStale(false);
      }
    } else {
      // No cache — show loading and fetch
      setIsLoading(true);
      fetchData();
    }
  }, [url, skip, ttl, noStale, fetchData]);

  const refresh = useCallback(async () => {
    if (url) {
      memoryCache.delete(url);
      localStorage.removeItem(CACHE_PREFIX + url);
    }
    setIsLoading(true);
    await fetchData();
  }, [url, fetchData]);

  return { data, isLoading, isStale, error, refresh };
}

export default useCache;
