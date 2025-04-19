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
 * @returns A comma-separated string of glob patterns to exclude
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

  // Ensure paths are properly formatted for VSCode's globbing
  const formattedPatterns = excludeFolders.map(pattern => {
    // Make sure patterns have ** at both ends for proper glob matching
    if (!pattern.startsWith("**")) {
      pattern = `**/${pattern}`;
    }
    if (!pattern.endsWith("**") && !pattern.endsWith("*")) {
      pattern = `${pattern}/**`;
    }
    console.log(`Formatted exclusion pattern: ${pattern}`);
    return pattern;
  });

  // For VS Code findFiles, return a single pattern if there's only one
  // Otherwise, return a comma-separated list which VS Code handles properly
  return formattedPatterns.join(",");
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

  // Check common exclusions first for performance (most common use case)
  if (normalizedPath.includes("/node_modules/")) {
    return true;
  }

  // Check for other common directories directly similar to node_modules check
  if (normalizedPath.includes("/vendor/") && 
      !normalizedPath.endsWith("/vendor") && 
      normalizedPath.split("/").pop() !== "vendor") {
    console.log(`Excluded vendor path: ${normalizedPath}`);
    return true;
  }

  if (normalizedPath.includes("/venv/")) {
    console.log(`Excluded venv path: ${normalizedPath}`);
    return true;
  }

  if (normalizedPath.includes("/.git/")) {
    console.log(`Excluded git path: ${normalizedPath}`);
    return true;
  }

  if (normalizedPath.includes("/build/")) {
    console.log(`Excluded build path: ${normalizedPath}`);
    return true;
  }

  if (normalizedPath.includes("/.dart_tool/")) {
    console.log(`Excluded dart_tool path: ${normalizedPath}`);
    return true;
  }

  // Check if the path matches any exclude pattern
  for (const pattern of excludeFolders) {
    // For patterns like **/{path}/** - extract the actual folder path
    if (pattern.startsWith("**/") && pattern.endsWith("/**")) {
      const folderPath = pattern.substring(3, pattern.length - 3);
      // Check if the normalized path contains this folder path segment
      if (folderPath && normalizedPath.includes(`/${folderPath}/`)) {
        console.log(`Excluded by extracted folder path ${folderPath}: ${normalizedPath}`);
        return true;
      }
    } else {
      // Convert glob pattern to a regex pattern for other pattern types
      const regexPattern = pattern
        .replace(/\*\*/g, ".*") // ** becomes .* (any characters)
        .replace(/\*/g, "[^/]*") // * becomes [^/]* (any characters except /)
        .replace(/\?/g, "[^/]") // ? becomes [^/] (any single character except /)
        .replace(/\./g, "\\.") // Escape dots
        .replace(/\//g, "\\/"); // Escape slashes

      try {
        const regex = new RegExp(regexPattern, "i"); // Case insensitive
        if (regex.test(normalizedPath)) {
          console.log(`Excluded by pattern ${pattern}: ${normalizedPath}`);
          return true;
        }
      } catch (e) {
        // If regex creation fails, fall back to simple include check
        // Remove glob patterns and check for path inclusion
        const simplePattern = pattern
          .replace(/\*\*/g, "")
          .replace(/\*/g, "")
          .replace(/\?/g, "")
          .replace(/^\/+|\/+$/g, "");

        if (simplePattern && normalizedPath.includes(simplePattern)) {
          console.log(`Excluded by simple pattern ${simplePattern}: ${normalizedPath}`);
          return true;
        }
      }
    }
  }

  return false;
} 