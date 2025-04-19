import * as semver from "semver";

/**
 * Determines the type of update available between current and latest versions.
 * Uses semver to classify updates as major, minor, patch, or prerelease.
 * Handles complex version specifiers and ranges by coercing to standard semver format.
 *
 * @param currentVersion - The current version string or version range
 * @param latestVersion - The latest available version string
 * @returns The update type (major, minor, patch, prerelease, or none)
 */
export function getUpdateType(
  currentVersion: string,
  latestVersion: string
): "major" | "minor" | "patch" | "prerelease" | "none" {
  const cleanCurrent = semver.valid(semver.coerce(currentVersion));
  const cleanLatest = semver.valid(semver.coerce(latestVersion));

  // Handle cases where currentVersion is a range or complex specifier
  // If coerce fails, we can't reliably compare. Also check if latest is actually greater.
  if (!cleanCurrent || !cleanLatest || !semver.gt(cleanLatest, cleanCurrent)) {
    // Add a check for simple 'any' or '*' specifiers if needed
    if (currentVersion.toLowerCase() === "any" || currentVersion === "*") {
      // If specifier is 'any', consider it up-to-date unless a specific policy dictates otherwise
      return "none";
    }
    // Check if currentVersion is a valid range and if latest satisfies it
    try {
      if (
        semver.validRange(currentVersion) &&
        cleanLatest &&
        semver.satisfies(cleanLatest, currentVersion)
      ) {
        // If latest satisfies the current range, no update needed *within that range*
        // However, we might still want to show the absolute latest, so proceed with diff
      } else if (!semver.validRange(currentVersion)) {
        // If not a valid version or range, cannot determine update type reliably
        return "none";
      }
    } catch (e) {
      // If range parsing fails
      return "none";
    }
    // If latest is not greater than current coerced version, no update
    if (
      !cleanLatest ||
      !cleanCurrent ||
      !semver.gt(cleanLatest, cleanCurrent)
    ) {
      return "none";
    }
  }

  const diff = semver.diff(cleanCurrent, cleanLatest);
  // semver.diff returns null if versions are identical after coercion, handle this
  if (!diff) return "none";

  // Ensure diff is one of the expected types
  if (["major", "minor", "patch", "prerelease"].includes(diff)) {
    return diff as "major" | "minor" | "patch" | "prerelease";
  }

  return "none"; // Fallback if diff is unexpected
} 