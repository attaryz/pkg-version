/**
 * Registry URLs for package managers
 * Centralized configuration for all package registry endpoints
 */

export const REGISTRY_URLS = {
  npm: {
    latest: (packageName: string) => `https://registry.npmjs.org/${packageName}/latest`,
    package: (packageName: string) => `https://registry.npmjs.org/${packageName}`,
  },
  
  packagist: {
    package: (packageName: string) => `https://repo.packagist.org/p2/${packageName}.json`,
  },
  
  pypi: {
    package: (packageName: string) => `https://pypi.org/pypi/${packageName}/json`,
  },
  
  pubdev: {
    package: (packageName: string) => `https://pub.dev/api/packages/${packageName}`,
  },
  
  crates: {
    package: (packageName: string) => `https://crates.io/api/v1/crates/${packageName}`,
  },
  
  maven: {
    search: 'https://search.maven.org/solrsearch/select',
  },
  
  // Vulnerability databases
  osv: {
    query: 'https://api.osv.dev/v1/query',
  },
  
  snyk: {
    base: 'https://api.snyk.io/v1',
    user: 'https://api.snyk.io/v1/user',
  },
  
  github: {
    graphql: 'https://api.github.com/graphql',
    advisories: 'https://github.com/advisories',
  },
} as const;

/**
 * API timeouts in milliseconds
 */
export const API_TIMEOUTS = {
  default: 5000,
  packagist: 5000,
  osv: 10000,
  github: 10000,
} as const;

/**
 * Cache TTL in minutes
 */
export const CACHE_TTL = {
  vulnerabilities: 60,
  updates: 30,
} as const;
