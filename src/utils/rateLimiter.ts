/**
 * Simple rate limiter to prevent excessive API calls
 * Uses a token bucket algorithm
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number = 10, refillRate: number = 2) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }

    // Wait until we have a token
    const waitTime = (1 - this.tokens) / this.refillRate * 1000;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    this.refill();
    this.tokens -= 1;
  }

  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

// Global rate limiters for different registries
const rateLimiters = new Map<string, RateLimiter>();

export function getRateLimiter(registry: string): RateLimiter {
  if (!rateLimiters.has(registry)) {
    // Different rate limits for different registries
    const limits: { [key: string]: { maxTokens: number; refillRate: number } } = {
      npm: { maxTokens: 20, refillRate: 5 }, // 5 requests per second, burst of 20
      packagist: { maxTokens: 10, refillRate: 2 }, // 2 requests per second, burst of 10
      pypi: { maxTokens: 15, refillRate: 3 }, // 3 requests per second, burst of 15
      pub: { maxTokens: 15, refillRate: 3 },
      crates: { maxTokens: 15, refillRate: 3 },
    };

    const config = limits[registry] || { maxTokens: 10, refillRate: 2 };
    rateLimiters.set(registry, new RateLimiter(config.maxTokens, config.refillRate));
  }

  return rateLimiters.get(registry)!;
}
