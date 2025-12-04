import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { fetchLatestPypiVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a pyproject.toml file and extracts Poetry dependencies.
 * Creates dependency objects WITHOUT fetching latest versions for faster initial load.
 * Versions will be fetched in the background by the DependencyProvider.
 *
 * @param pyprojectTomlUri - URI of the pyproject.toml file
 * @returns Promise resolving to array of dependencies
 */
export async function getDepsInPyprojectToml(
  pyprojectTomlUri: vscode.Uri
): Promise<Dependency[]> {
  if (!pathExists(pyprojectTomlUri.fsPath)) {
    return Promise.resolve([]);
  }

  try {
    const buffer = await vscode.workspace.fs.readFile(pyprojectTomlUri);
    const content = Buffer.from(buffer).toString("utf8");
    
    // Parse TOML content manually for Poetry dependencies
    const dependencies = parsePoetryDependencies(content);
    const deps: Dependency[] = [];

    for (const [name, versionSpec] of Object.entries(dependencies)) {
      // Create dependency without fetching version (will be loaded in background)
      deps.push(new Dependency(
        name,
        versionSpec,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined, // latestVersion - will be loaded in background
        "none", // updateType - will be determined when version is loaded
        "poetry",
        pyprojectTomlUri.fsPath
      ));
    }

    return deps;
  } catch (err: any) {
    console.error(
      `Error reading or parsing ${pyprojectTomlUri.fsPath}:`,
      err
    );
    vscode.window.showErrorMessage(
      `Failed to read dependencies from ${vscode.workspace.asRelativePath(
        pyprojectTomlUri
      )}`
    );
    return [];
  }
}

/**
 * Simple TOML parser specifically for Poetry dependencies.
 * Extracts dependencies from [tool.poetry.dependencies] and [tool.poetry.group.*.dependencies] sections.
 *
 * @param content - The TOML file content
 * @returns Object with package names as keys and version specs as values
 */
function parsePoetryDependencies(content: string): Record<string, string> {
  const dependencies: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  
  let inDependenciesSection = false;
  let inGroupDependenciesSection = false;
  let currentSection = "";
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }
    
    // Check for section headers
    if (trimmedLine.startsWith("[")) {
      inDependenciesSection = trimmedLine === "[tool.poetry.dependencies]";
      inGroupDependenciesSection = /^\[tool\.poetry\.group\..+\.dependencies\]$/.test(trimmedLine);
      currentSection = trimmedLine;
      continue;
    }
    
    // Parse dependencies if we're in a dependencies section
    if (inDependenciesSection || inGroupDependenciesSection) {
      // Skip python version constraint
      if (trimmedLine.startsWith("python =")) {
        continue;
      }
      
      // Parse dependency line: package = "version" or package = {version = "version", ...}
      const simpleMatch = trimmedLine.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (simpleMatch) {
        const [, packageName, versionSpec] = simpleMatch;
        dependencies[packageName] = versionSpec;
        continue;
      }
      
      // Parse complex dependency with table syntax: package = {version = "version", ...}
      const complexMatch = trimmedLine.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{(.+)\}/);
      if (complexMatch) {
        const [, packageName, tableContent] = complexMatch;
        const versionMatch = tableContent.match(/version\s*=\s*"([^"]+)"/);
        if (versionMatch) {
          dependencies[packageName] = versionMatch[1];
        }
        continue;
      }
      
      // Handle multi-line table syntax (basic support)
      const tableStartMatch = trimmedLine.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{/);
      if (tableStartMatch) {
        // For now, we'll skip multi-line table dependencies
        // A more robust parser would handle this case
        continue;
      }
    }
  }
  
  return dependencies;
}

/**
 * Generates a requirements.txt content from pyproject.toml dependencies.
 *
 * @param pyprojectTomlUri - URI of the pyproject.toml file
 * @returns Promise resolving to requirements.txt content string
 */
export async function generateRequirementsTxt(
  pyprojectTomlUri: vscode.Uri
): Promise<string> {
  if (!pathExists(pyprojectTomlUri.fsPath)) {
    throw new Error("pyproject.toml file not found");
  }

  try {
    const buffer = await vscode.workspace.fs.readFile(pyprojectTomlUri);
    const content = Buffer.from(buffer).toString("utf8");
    const dependencies = parsePoetryDependencies(content);
    
    // Convert Poetry version specs to requirements.txt format
    const requirementsLines: string[] = [];
    
    for (const [packageName, versionSpec] of Object.entries(dependencies)) {
      // Convert Poetry version syntax to pip syntax
      let pipVersionSpec = convertPoetryVersionToPip(versionSpec);
      requirementsLines.push(`${packageName}${pipVersionSpec}`);
    }
    
    return requirementsLines.join("\n");
  } catch (err: any) {
    console.error(
      `Error generating requirements.txt from ${pyprojectTomlUri.fsPath}:`,
      err
    );
    throw err;
  }
}

/**
 * Converts Poetry version specification to pip-compatible format.
 *
 * @param poetryVersion - Poetry version specification
 * @returns pip-compatible version specification
 */
function convertPoetryVersionToPip(poetryVersion: string): string {
  // Handle common Poetry version patterns
  if (poetryVersion.startsWith("^")) {
    // ^1.2.3 -> >=1.2.3,<2.0.0
    const version = poetryVersion.slice(1);
    const parts = version.split(".");
    if (parts.length >= 2) {
      const major = parseInt(parts[0]);
      return `>=${version},<${major + 1}.0.0`;
    }
    return `>=${version}`;
  } else if (poetryVersion.startsWith("~")) {
    // ~1.2.3 -> >=1.2.3,<1.3.0
    const version = poetryVersion.slice(1);
    const parts = version.split(".");
    if (parts.length >= 2) {
      const major = parts[0];
      const minor = parseInt(parts[1]);
      return `>=${version},<${major}.${minor + 1}.0`;
    }
    return `>=${version}`;
  } else if (poetryVersion.includes(",")) {
    // Multiple constraints: ">=1.0,<2.0" -> >=1.0,<2.0
    return poetryVersion;
  } else if (poetryVersion.match(/^[<>=!]/)) {
    // Already has operators: ">=1.0" -> >=1.0
    return poetryVersion;
  } else {
    // Exact version: "1.2.3" -> ==1.2.3
    return `==${poetryVersion}`;
  }
}