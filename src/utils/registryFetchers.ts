import axios from "axios";
import * as semver from "semver";
import { getUpdateCache } from "./updateCache";
import { REGISTRY_URLS, API_TIMEOUTS } from "../config/registryUrls";
import { getRateLimiter } from "./rateLimiter";

/**
 * Fetches the latest version of a package from npm registry.
 * Makes an HTTP request to the public npm registry API.
 * Uses caching to reduce API calls.
 *
 * @param packageName - The name of the npm package to check
 * @param currentVersion - Optional current version for cache key
 * @returns The latest version string or undefined if fetching fails, along with deprecated status
 */
export async function fetchLatestNpmVersion(
  packageName: string,
  currentVersion?: string
): Promise<{ version?: string; deprecated?: boolean } | undefined> {
  // Check cache first
  if (currentVersion) {
    const cache = getUpdateCache();
    const cached = cache.get(packageName, currentVersion, "npm");
    if (cached) {
      return { version: cached.latestVersion, deprecated: cached.deprecated };
    }
  }

  try {
    // Rate limiting
    await getRateLimiter('npm').acquire();
    
    // Use a public registry URL
    const response = await axios.get(
      REGISTRY_URLS.npm.latest(packageName),
      { timeout: API_TIMEOUTS.default }
    );
    if (response.data && response.data.version) {
      const latestVersion = response.data.version;
      const deprecated = response.data.deprecated || false;

      // Cache the result if we have current version
      if (currentVersion && latestVersion) {
        const cache = getUpdateCache();
        const updateType = getUpdateType(currentVersion, latestVersion);
        cache.set(packageName, currentVersion, "npm", latestVersion, updateType, deprecated);
      }

      return { version: latestVersion, deprecated };
    }
  } catch (error: any) {
    // Log specific error for debugging, but don't spam the user's window
    if (error.response && error.response.status === 404) {
      console.warn(`Package ${packageName} not found on npm registry.`);
    } else {
      console.error(
        `Failed to fetch latest version for ${packageName}:`,
        error.message
      );
    }
    // Don't show error message to user for individual package fetch failures
  }
  return undefined;
}

/**
 * Fetches the latest version of a package from the crates.io (Rust/Cargo) registry.
 * Uses the crates.io API to get package information.
 * Uses caching to reduce API calls when currentVersion is provided.
 *
 * @param packageName - The name of the Rust crate
 * @param currentVersion - Optional current version for cache key and update cache
 * @returns The latest version string or undefined if fetching fails
 */
export async function fetchLatestCratesVersion(
  packageName: string,
  currentVersion?: string
): Promise<string | undefined> {
  // Check cache first
  if (currentVersion) {
    const cache = getUpdateCache();
    const cached = cache.get(packageName, currentVersion, "cargo");
    if (cached) {
      return cached.latestVersion;
    }
  }

  try {
    // Rate limiting
    await getRateLimiter('crates').acquire();
    
    const response = await axios.get(
      REGISTRY_URLS.crates.package(packageName)
    );

    // Prefer crate.max_version if present; fallback to versions array
    const latestVersion: string | undefined =
      response?.data?.crate?.max_version ||
      response?.data?.crate?.newest_version ||
      (Array.isArray(response?.data?.versions)
        ? response.data.versions
            .map((v: any) => v?.num)
            .filter((v: string | undefined) => !!v)
            .sort((a: string, b: string) => {
              const av = semver.valid(semver.coerce(a)) || "0.0.0";
              const bv = semver.valid(semver.coerce(b)) || "0.0.0";
              return semver.rcompare(av, bv);
            })[0]
        : undefined);

    if (latestVersion) {
      if (currentVersion) {
        const cache = getUpdateCache();
        const updateType = getUpdateType(currentVersion, latestVersion);
        cache.set(packageName, currentVersion, "cargo", latestVersion, updateType);
      }
      return latestVersion;
    }
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      console.warn(`Crate ${packageName} not found on crates.io.`);
    } else {
      console.error(
        `Failed to fetch latest version for ${packageName} from crates.io:`,
        error.message
      );
    }
  }
  return undefined;
}

/**
 * Helper function to determine update type
 */
function getUpdateType(current: string, latest: string): "major" | "minor" | "patch" | "prerelease" | "none" {
  try {
    const currentClean = semver.valid(semver.coerce(current));
    const latestClean = semver.valid(semver.coerce(latest));
    
    if (!currentClean || !latestClean) return "none";
    if (currentClean === latestClean) return "none";
    
    const diff = semver.diff(currentClean, latestClean);
    if (diff === "major") return "major";
    if (diff === "minor" || diff === "preminor") return "minor";
    if (diff === "patch" || diff === "prepatch") return "patch";
    if (diff === "prerelease" || diff === "premajor") return "prerelease";
    
    return "none";
  } catch {
    return "none";
  }
}

/**
 * Fetches the latest version of a package from the Packagist (PHP/Composer) registry.
 * Uses Packagist API v2 to get package information.
 * Uses caching to reduce API calls.
 *
 * @param packageName - The name of the Composer package (vendor/package format)
 * @param currentVersion - Optional current version for cache key
 * @returns The latest stable version string or undefined if fetching fails
 */
export async function fetchLatestPackagistVersion(
  packageName: string,
  currentVersion?: string
): Promise<string | undefined> {
  // Check cache first
  if (currentVersion) {
    const cache = getUpdateCache();
    const cached = cache.get(packageName, currentVersion, "composer");
    if (cached) {
      return cached.latestVersion;
    }
  }
  // Packagist API requires vendor/package format
  if (!packageName.includes("/")) {
    console.warn(`Invalid composer package name format: ${packageName}`);
    return undefined;
  }

  // Clean package name for API requests
  const cleanPackageName = packageName.trim().toLowerCase();
  console.log(`Fetching latest version for ${cleanPackageName} from Packagist`);

  try {
    // Rate limiting
    await getRateLimiter('packagist').acquire();
    
    // Use the Packagist API v2
    const response = await axios.get(
      REGISTRY_URLS.packagist.package(cleanPackageName),
      { timeout: API_TIMEOUTS.packagist }
    );

    // The response contains package details, including versions
    if (
      response.data &&
      response.data.packages &&
      response.data.packages[cleanPackageName]
    ) {
      // Get all versions, filter out dev/alpha/beta unless explicitly requested (more complex)
      // For simplicity, find the latest stable version
      const versions = response.data.packages[cleanPackageName];

      if (!Array.isArray(versions) || versions.length === 0) {
        console.warn(`No versions found for ${cleanPackageName} on Packagist.`);
        return undefined;
      }

      console.log(`Found ${versions.length} versions for ${cleanPackageName}`);

      let latestStableVersion: string | undefined = undefined;
      let latestVersionTime = 0;

      for (const versionData of versions) {
        if (!versionData.version || !versionData.version_normalized) {
          continue; // Skip versions with missing data
        }

        // Version contains dev/alpha/beta/RC?
        const isDev = /dev|alpha|beta|RC/i.test(versionData.version);

        if (isDev && latestStableVersion) {
          // Skip dev versions if we already found a stable version
          continue;
        }

        if (
          versionData.version_normalized &&
          semver.valid(semver.coerce(versionData.version_normalized))
        ) {
          // Check if it's a stable version (no pre-release identifiers)
          const isPrerelease = semver.prerelease(
            versionData.version_normalized
          );

          if (!isPrerelease) {
            // For stable versions, use time-based comparison if available
            if (versionData.time) {
              const versionTime = new Date(versionData.time).getTime();
              // Find the most recently published stable version
              if (versionTime > latestVersionTime) {
                latestStableVersion = versionData.version;
                latestVersionTime = versionTime;
              }
            } else {
              // Fallback to semver comparison if time is not available
              if (!latestStableVersion) {
                latestStableVersion = versionData.version;
              } else if (
                semver.gt(
                  semver.coerce(versionData.version_normalized) || "0.0.0",
                  semver.coerce(latestStableVersion) || "0.0.0"
                )
              ) {
                latestStableVersion = versionData.version;
              }
            }
          } else if (!latestStableVersion && isDev) {
            // If we still don't have a stable version, use the dev version
            if (!latestStableVersion) {
              latestStableVersion = versionData.version;
              if (versionData.time) {
                latestVersionTime = new Date(versionData.time).getTime();
              }
            }
          }
        }
      }

      if (latestStableVersion) {
        console.log(
          `Latest version for ${cleanPackageName} is ${latestStableVersion}`
        );
        
        // Cache the result
        if (currentVersion) {
          const cache = getUpdateCache();
          const updateType = getUpdateType(currentVersion, latestStableVersion);
          cache.set(packageName, currentVersion, "composer", latestStableVersion, updateType);
        }
        
        return latestStableVersion;
      } else {
        // Fallback if no stable version found, maybe return latest pre-release?
        // For now, return undefined if no stable found.
        console.warn(
          `No stable version found for ${cleanPackageName} on Packagist.`
        );
      }
    } else {
      console.warn(`Unexpected response format for ${cleanPackageName}`);
    }
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      console.warn(`Package ${cleanPackageName} not found on Packagist.`);
    } else {
      console.error(
        `Failed to fetch latest version for ${cleanPackageName} from Packagist:`,
        error.message
      );
    }
  }
  return undefined;
}

/**
 * Fetches the latest version of a package from the PyPI (Python) registry.
 * Uses the PyPI JSON API to get package information.
 *
 * @param packageName - The name of the Python package
 * @returns The latest version string or undefined if fetching fails
 */
export async function fetchLatestPypiVersion(
  packageName: string
): Promise<string | undefined> {
  try {
    // Rate limiting
    await getRateLimiter('pypi').acquire();
    
    // PyPI JSON API endpoint
    const response = await axios.get(
      `https://pypi.org/pypi/${packageName}/json`
    );
    if (response.data && response.data.info && response.data.info.version) {
      return response.data.info.version;
    }
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      console.warn(`Package ${packageName} not found on PyPI.`);
    } else {
      console.error(
        `Failed to fetch latest version for ${packageName} from PyPI:`,
        error.message
      );
    }
  }
  return undefined;
}

/**
 * Fetches the latest version of a package from the Pub.dev (Dart/Flutter) registry.
 * Uses the Pub.dev API to get package information.
 *
 * @param packageName - The name of the Dart/Flutter package
 * @returns The latest version string or undefined if fetching fails
 */
export async function fetchLatestPubDevVersion(
  packageName: string
): Promise<string | undefined> {
  try {
    // Rate limiting
    await getRateLimiter('pub').acquire();
    
    // Pub.dev API endpoint
    const response = await axios.get(
      `https://pub.dev/api/packages/${packageName}`
    );
    if (response.data && response.data.latest && response.data.latest.version) {
      return response.data.latest.version;
    }
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      console.warn(`Package ${packageName} not found on Pub.dev.`);
    } else {
      console.error(
        `Failed to fetch latest version for ${packageName} from Pub.dev:`,
        error.message
      );
    }
  }
  return undefined;
}

/**
 * Fetches the latest version of a package from the Cargo (Rust) registry.
 * Alias for fetchLatestCratesVersion for consistency.
 *
 * @param packageName - The name of the Rust crate
 * @param currentVersion - Optional current version for cache key
 * @returns The latest version string or undefined if fetching fails
 */
export async function fetchLatestCargoVersion(
  packageName: string,
  currentVersion?: string
): Promise<string | undefined> {
  return fetchLatestCratesVersion(packageName, currentVersion);
} 