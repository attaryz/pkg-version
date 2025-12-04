import * as fs from "fs";
import * as vscode from "vscode";

/**
 * Utility function to check if a file path exists.
 *
 * @param p - The file path to check
 * @returns true if the file exists, false otherwise
 */
export function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
  } catch (err) {
    return false;
  }
  return true;
}

/**
 * Gets the exclude pattern from configuration for VS Code findFiles API.
 * Converts the array of exclude patterns into a format VS Code can use.
 *
 * @returns A comma-separated string of glob patterns to exclude (legacy, use getExcludePatternForVSCode instead)
 * @deprecated Use getExcludePatternForVSCode() for proper VS Code glob format
 */
export function getExcludePattern(): string {
  const configuration = vscode.workspace.getConfiguration("pkgVersion");
  const excludeFolders: string[] = configuration.get("excludeFolders") || [
    "**/node_modules/**",
    "**/vendor/**",
    "**/venv/**",
    "**/.git/**",
    "**/build/**",
    "**/.dart_tool/**",
  ];

  // Return patterns as-is - they should already be properly formatted
  // Don't modify them as it can break file-specific patterns like **/*.lock
  console.log(`Using ${excludeFolders.length} exclusion patterns`);
  const formattedPatterns = excludeFolders;

  // For VS Code findFiles, return a single pattern if there's only one
  // Otherwise, return a comma-separated list which VS Code handles properly
  return formattedPatterns.join(",");
}

/**
 * Gets the exclude pattern in the proper format for VS Code's findFiles API.
 * Returns a brace-expanded pattern that VS Code can properly parse.
 *
 * @returns A brace-expanded glob pattern string like "{pattern1,pattern2,pattern3}"
 */
export function getExcludePatternForVSCode(): string {
  const configuration = vscode.workspace.getConfiguration("pkgVersion");
  const excludeFolders: string[] = configuration.get("excludeFolders") || [
    "**/node_modules/**",
    "**/vendor/**",
    "**/venv/**",
    "**/.git/**",
    "**/build/**",
    "**/.dart_tool/**",
  ];

  // Always include critical exclusions that should never be scanned
  const criticalExclusions = [
    "**/node_modules/**",
    "**/venv/**",
    "**/.git/**",
    "**/build/**",
    "**/dist/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/bin/**",
    "**/__pycache__/**",
    "**/.dart_tool/**",
    "**/vendor/*/**" // Exclude nested vendor files
  ];

  // Merge user exclusions with critical ones, removing duplicates
  const allExclusions = [...new Set([...criticalExclusions, ...excludeFolders])];

  console.log(`[fileUtils] Using ${allExclusions.length} exclusion patterns for VS Code`);

  // Return in brace-expanded format that VS Code understands
  return `{${allExclusions.join(",")}}`;
}

/**
 * Determines if a file is in an excluded directory.
 * Provides more fine-grained control than VS Code's built-in glob handling.
 *
 * @param filePath - The full path of the file to check
 * @returns true if the file is in an excluded directory, false otherwise
 */
export function isFileExcluded(filePath: string): boolean {
  const configuration = vscode.workspace.getConfiguration("pkgVersion");
  const excludeFolders: string[] = configuration.get("excludeFolders") || [];

  // Normalize path for consistent comparison (use forward slashes)
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Check if the path matches any exclude pattern
  for (const pattern of excludeFolders) {
    if (matchesGlobPattern(normalizedPath, pattern)) {
      console.log(`Excluded by pattern "${pattern}": ${normalizedPath}`);
      return true;
    }
  }

  return false;
}

/**
 * Checks if a path matches a glob pattern
 * Supports **, *, and ? wildcards
 * @param path The file path to check
 * @param pattern The glob pattern to match against
 * @returns true if the path matches the pattern
 */
export function matchesGlobPattern(path: string, pattern: string): boolean {
  // Normalize the pattern
  let normalizedPattern = pattern.replace(/\\/g, "/");
  
  // Convert glob pattern to regex
  let regexStr = normalizedPattern
    .replace(/\./g, "\\.") // Escape dots
    .replace(/\*\*/g, "§DOUBLESTAR§") // Temporarily mark **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/§DOUBLESTAR§/g, ".*") // ** matches anything including /
    .replace(/\?/g, "[^/]"); // ? matches single character except /

  // Handle pattern anchoring
  if (normalizedPattern.startsWith("**/")) {
    // Pattern like **/node_modules/** should match anywhere in path
    regexStr = regexStr.substring(2); // Remove leading .*
    // Match if pattern appears anywhere in path
    regexStr = `(^|/)${regexStr}`;
  } else if (!normalizedPattern.startsWith("/")) {
    // Pattern without leading / should match from start
    regexStr = "^" + regexStr;
  }

  // Handle pattern ending
  if (normalizedPattern.endsWith("/**")) {
    // Pattern ending with /** matches folder and all contents
    // Already handled by .* at the end
  } else if (!normalizedPattern.endsWith("*")) {
    // Exact match required at end
    regexStr = regexStr + "$";
  }

  try {
    const regex = new RegExp(regexStr, "i");
    return regex.test(path);
  } catch (e) {
    console.error(`Failed to create regex from pattern "${pattern}":`, e);
    
    // Fallback: simple substring match
    const simplifiedPattern = normalizedPattern
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/\?/g, "")
      .replace(/^\/+|\/+$/g, "");
    
    if (simplifiedPattern) {
      return path.toLowerCase().includes(simplifiedPattern.toLowerCase());
    }
    
    return false;
  }
} 