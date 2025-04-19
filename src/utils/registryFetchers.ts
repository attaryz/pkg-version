import axios from "axios";
import * as semver from "semver";

/**
 * Fetches the latest version of a package from npm registry.
 * Makes an HTTP request to the public npm registry API.
 *
 * @param packageName - The name of the npm package to check
 * @returns The latest version string or undefined if fetching fails
 */
export async function fetchLatestNpmVersion(
  packageName: string
): Promise<string | undefined> {
  try {
    // Use a public registry URL
    const response = await axios.get(
      `https://registry.npmjs.org/${packageName}/latest`
    );
    if (response.data && response.data.version) {
      return response.data.version;
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
 * Fetches the latest version of a package from the Packagist (PHP/Composer) registry.
 * Uses Packagist API v2 to get package information.
 *
 * @param packageName - The name of the Composer package (vendor/package format)
 * @returns The latest stable version string or undefined if fetching fails
 */
export async function fetchLatestPackagistVersion(
  packageName: string
): Promise<string | undefined> {
  // Packagist API requires vendor/package format
  if (!packageName.includes("/")) {
    console.warn(`Invalid composer package name format: ${packageName}`);
    return undefined;
  }

  // Clean package name for API requests
  const cleanPackageName = packageName.trim().toLowerCase();
  console.log(`Fetching latest version for ${cleanPackageName} from Packagist`);

  try {
    // Use the Packagist API v2
    const response = await axios.get(
      `https://repo.packagist.org/p2/${cleanPackageName}.json`,
      { timeout: 5000 } // Add timeout to prevent hanging requests
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