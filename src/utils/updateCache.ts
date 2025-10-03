/**
 * Cache entry for package update information
 */
interface UpdateCacheEntry {
  latestVersion: string
  updateType: "major" | "minor" | "patch" | "prerelease" | "none"
  timestamp: number
}

/**
 * Simple in-memory cache for package update check results
 * Reduces API calls to package registries and improves performance
 */
export class UpdateCache {
  private cache: Map<string, UpdateCacheEntry> = new Map()
  private ttl: number // Time to live in milliseconds

  constructor(ttlMinutes: number = 30) {
    this.ttl = ttlMinutes * 60 * 1000 // Convert to milliseconds
  }

  /**
   * Generate cache key from package info
   */
  private getCacheKey(packageName: string, currentVersion: string, packageManager: string): string {
    return `${packageManager}:${packageName}@${currentVersion}`
  }

  /**
   * Get cached update info if available and not expired
   */
  public get(
    packageName: string,
    currentVersion: string,
    packageManager: string
  ): UpdateCacheEntry | undefined {
    const key = this.getCacheKey(packageName, currentVersion, packageManager)
    const entry = this.cache.get(key)

    if (!entry) {
      return undefined
    }

    // Check if expired
    const now = Date.now()
    if (now - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return undefined
    }

    return entry
  }

  /**
   * Store update info in cache
   */
  public set(
    packageName: string,
    currentVersion: string,
    packageManager: string,
    latestVersion: string,
    updateType: "major" | "minor" | "patch" | "prerelease" | "none"
  ): void {
    const key = this.getCacheKey(packageName, currentVersion, packageManager)
    this.cache.set(key, {
      latestVersion,
      updateType,
      timestamp: Date.now(),
    })
  }

  /**
   * Clear all cached results
   */
  public clear(): void {
    this.cache.clear()
  }

  /**
   * Clear expired entries
   */
  public clearExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get cache statistics
   */
  public getStats(): { size: number; ttlMinutes: number } {
    return {
      size: this.cache.size,
      ttlMinutes: this.ttl / (60 * 1000),
    }
  }

  /**
   * Invalidate cache for a specific package
   */
  public invalidate(packageName: string, currentVersion: string, packageManager: string): void {
    const key = this.getCacheKey(packageName, currentVersion, packageManager)
    this.cache.delete(key)
  }
}

// Global cache instance
let cacheInstance: UpdateCache | undefined

/**
 * Get the global update cache instance
 */
export function getUpdateCache(): UpdateCache {
  if (!cacheInstance) {
    cacheInstance = new UpdateCache(30) // 30 minutes TTL
  }
  return cacheInstance
}

/**
 * Clear the update cache (useful when refreshing)
 */
export function clearUpdateCache(): void {
  if (cacheInstance) {
    cacheInstance.clear()
  }
}
