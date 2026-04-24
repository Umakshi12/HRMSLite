/**
 * In-memory cache layer for Google Sheets data.
 * Eliminates redundant API calls and prevents quota exhaustion.
 * TTL-based expiry with per-sheet granularity.
 */

class SheetCache {
  constructor() {
    this.store = new Map();
    this.DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
    this.METADATA_TTL = 10 * 60 * 1000; // 10 minutes for sheet names
    this.pendingRequests = new Map(); // Dedup in-flight requests
  }

  /**
   * Get cached value if still valid
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Set cache with optional TTL override
   */
  set(key, value, ttl = this.DEFAULT_TTL) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      cachedAt: Date.now(),
    });
  }

  /**
   * Deduplicate concurrent requests for the same key.
   * If another caller is already fetching the same data, piggyback on it.
   */
  async getOrFetch(key, fetchFn, ttl = this.DEFAULT_TTL) {
    // Return cached value if available
    const cached = this.get(key);
    if (cached !== null) return cached;

    // If there's already a pending request for this key, wait for it
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }

    // Start the fetch and store the promise
    const promise = fetchFn()
      .then((result) => {
        this.set(key, result, ttl);
        this.pendingRequests.delete(key);
        return result;
      })
      .catch((err) => {
        this.pendingRequests.delete(key);
        throw err;
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Invalidate a specific key or pattern
   */
  invalidate(keyOrPattern) {
    if (typeof keyOrPattern === 'string') {
      this.store.delete(keyOrPattern);
    } else if (keyOrPattern instanceof RegExp) {
      for (const key of this.store.keys()) {
        if (keyOrPattern.test(key)) this.store.delete(key);
      }
    }
  }

  /**
   * Invalidate all sheet data caches (called after writes)
   */
  invalidateSheetData() {
    this.invalidate(/^sheet:/);
    this.invalidate(/^filter-opts:/);
    this.invalidate('sheet-names');
    this.invalidate('sheet-summary');
  }

  /**
   * Get cache stats for debugging
   */
  stats() {
    let valid = 0, expired = 0;
    const now = Date.now();
    for (const [, entry] of this.store) {
      if (now > entry.expiresAt) expired++;
      else valid++;
    }
    return { total: this.store.size, valid, expired, pending: this.pendingRequests.size };
  }

  /**
   * Cleanup expired entries (call periodically)
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

const cache = new SheetCache();

// Auto-cleanup every 10 minutes
setInterval(() => cache.cleanup(), 10 * 60 * 1000);

export default cache;
