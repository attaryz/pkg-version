/**
 * DependencyProvider - VS Code TreeView provider for package dependencies
 * 
 * This module implements the core functionality of the pkg-version extension:
 * - Scanning the workspace for package manifest files (package.json, composer.json, etc.)
 * - Parsing dependencies from these files
 * - Fetching latest versions from respective package registries
 * - Determining update status (major, minor, patch)
 * - Presenting dependencies in a TreeView with status indicators
 * 
 * TODO:
 * - Add support for additional package managers (Cargo, Go modules, etc.)
 * - Improve version comparison for complex version constraints
 * - Add batch update mechanism for dependencies
 * - Implement caching to reduce API calls
 * - Add offline mode for environments without internet access
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as yaml from "js-yaml" // Import js-yaml
import * as path from "path"
import axios from "axios" // Add axios import
import * as semver from "semver" // Add semver import

/**
 * Fetches the latest version of a package from npm registry.
 * Makes an HTTP request to the public npm registry API.
 * 
 * @param packageName - The name of the npm package to check
 * @returns The latest version string or undefined if fetching fails
 */
async function fetchLatestNpmVersion(
  packageName: string
): Promise<string | undefined> {
  try {
    // Use a public registry URL
    const response = await axios.get(
      `https://registry.npmjs.org/${packageName}/latest`
    )
    if (response.data && response.data.version) {
      return response.data.version
    }
  } catch (error: any) {
    // Log specific error for debugging, but don't spam the user's window
    if (error.response && error.response.status === 404) {
      console.warn(`Package ${packageName} not found on npm registry.`)
    } else {
      console.error(
        `Failed to fetch latest version for ${packageName}:`,
        error.message
      )
    }
    // Don't show error message to user for individual package fetch failures
    // vscode.window.showWarningMessage(`Could not fetch latest version for ${packageName}`);
  }
  return undefined
}

/**
 * Fetches the latest version of a package from the Packagist (PHP/Composer) registry.
 * Uses Packagist API v2 to get package information.
 * 
 * @param packageName - The name of the Composer package (vendor/package format)
 * @returns The latest stable version string or undefined if fetching fails
 */
async function fetchLatestPackagistVersion(
  packageName: string
): Promise<string | undefined> {
  // Packagist API requires vendor/package format
  if (!packageName.includes("/")) {
    console.warn(`Invalid composer package name format: ${packageName}`)
    return undefined
  }
  try {
    // Use the Packagist API v2
    const response = await axios.get(
      `https://repo.packagist.org/p2/${packageName}.json`
    )
    // The response contains package details, including versions
    if (
      response.data &&
      response.data.packages &&
      response.data.packages[packageName]
    ) {
      // Get all versions, filter out dev/alpha/beta unless explicitly requested (more complex)
      // For simplicity, find the latest stable version
      const versions = response.data.packages[packageName]
      let latestStableVersion: string | undefined = undefined
      let latestVersionTime = 0

      for (const versionData of versions) {
        if (
          versionData.version_normalized &&
          semver.valid(versionData.version_normalized)
        ) {
          // Check if it's a stable version (no pre-release identifiers)
          if (!semver.prerelease(versionData.version_normalized)) {
            const versionTime = new Date(versionData.time).getTime()
            // Find the most recently published stable version
            // Packagist doesn't always list versions chronologically in the API response
            if (versionTime > latestVersionTime) {
              latestStableVersion = versionData.version
              latestVersionTime = versionTime
            }
            // Alternative: Use semver.compare to find the highest version number
            // if (!latestStableVersion || semver.gt(versionData.version_normalized, semver.coerce(latestStableVersion)?.version || '0.0.0')) {
            //     latestStableVersion = versionData.version;
            // }
          }
        }
      }
      if (latestStableVersion) {
        return latestStableVersion
      } else {
        // Fallback if no stable version found, maybe return latest pre-release?
        // For now, return undefined if no stable found.
        console.warn(`No stable version found for ${packageName} on Packagist.`)
      }
    }
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      console.warn(`Package ${packageName} not found on Packagist.`)
    } else {
      console.error(
        `Failed to fetch latest version for ${packageName} from Packagist:`,
        error.message
      )
    }
  }
  return undefined
}

/**
 * Fetches the latest version of a package from the PyPI (Python) registry.
 * Uses the PyPI JSON API to get package information.
 * 
 * @param packageName - The name of the Python package
 * @returns The latest version string or undefined if fetching fails
 */
async function fetchLatestPypiVersion(
  packageName: string
): Promise<string | undefined> {
  try {
    // PyPI JSON API endpoint
    const response = await axios.get(
      `https://pypi.org/pypi/${packageName}/json`
    )
    if (response.data && response.data.info && response.data.info.version) {
      return response.data.info.version
    }
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      console.warn(`Package ${packageName} not found on PyPI.`)
    } else {
      console.error(
        `Failed to fetch latest version for ${packageName} from PyPI:`,
        error.message
      )
    }
  }
  return undefined
}

/**
 * Fetches the latest version of a package from the Pub.dev (Dart/Flutter) registry.
 * Uses the Pub.dev API to get package information.
 * 
 * @param packageName - The name of the Dart/Flutter package
 * @returns The latest version string or undefined if fetching fails
 */
async function fetchLatestPubDevVersion(
  packageName: string
): Promise<string | undefined> {
  try {
    // Pub.dev API endpoint
    const response = await axios.get(
      `https://pub.dev/api/packages/${packageName}`
    )
    if (response.data && response.data.latest && response.data.latest.version) {
      return response.data.latest.version
    }
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      console.warn(`Package ${packageName} not found on Pub.dev.`)
    } else {
      console.error(
        `Failed to fetch latest version for ${packageName} from Pub.dev:`,
        error.message
      )
    }
  }
  return undefined
}

/**
 * Determines the type of update available between current and latest versions.
 * Uses semver to classify updates as major, minor, patch, or prerelease.
 * Handles complex version specifiers and ranges by coercing to standard semver format.
 * 
 * @param currentVersion - The current version string or version range
 * @param latestVersion - The latest available version string
 * @returns The update type (major, minor, patch, prerelease, or none)
 * 
 * TODO: Improve handling of complex version ranges and constraints
 */
function getUpdateType(
  currentVersion: string,
  latestVersion: string
): "major" | "minor" | "patch" | "prerelease" | "none" {
  const cleanCurrent = semver.valid(semver.coerce(currentVersion))
  const cleanLatest = semver.valid(semver.coerce(latestVersion))

  // Handle cases where currentVersion is a range or complex specifier
  // If coerce fails, we can't reliably compare. Also check if latest is actually greater.
  if (!cleanCurrent || !cleanLatest || !semver.gt(cleanLatest, cleanCurrent)) {
    // Add a check for simple 'any' or '*' specifiers if needed
    if (currentVersion.toLowerCase() === "any" || currentVersion === "*") {
      // If specifier is 'any', consider it up-to-date unless a specific policy dictates otherwise
      return "none"
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
        return "none"
      }
    } catch (e) {
      // If range parsing fails
      return "none"
    }
    // If latest is not greater than current coerced version, no update
    if (
      !cleanLatest ||
      !cleanCurrent ||
      !semver.gt(cleanLatest, cleanCurrent)
    ) {
      return "none"
    }
  }

  const diff = semver.diff(cleanCurrent, cleanLatest)
  // semver.diff returns null if versions are identical after coercion, handle this
  if (!diff) return "none"

  // Ensure diff is one of the expected types
  if (["major", "minor", "patch", "prerelease"].includes(diff)) {
    return diff as "major" | "minor" | "patch" | "prerelease"
  }

  return "none" // Fallback if diff is unexpected
}

/**
 * The DependencyProvider class implements a VS Code TreeDataProvider.
 * It scans the workspace for package files and builds a tree of packages and dependencies.
 * The tree shows package files at the root level and their dependencies as children.
 * Dependencies display their current version, latest available version, and update status.
 */
export class DependencyProvider implements vscode.TreeDataProvider<Dependency> {
  constructor(private workspaceRoot: string | undefined) {}

  getTreeItem(element: Dependency): vscode.TreeItem {
    return element
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    Dependency | undefined | null | void
  > = new vscode.EventEmitter<Dependency | undefined | null | void>()
  readonly onDidChangeTreeData: vscode.Event<
    Dependency | undefined | null | void
  > = this._onDidChangeTreeData.event

  /**
   * Refreshes the tree view, triggering a re-scan of package files and dependencies.
   * This is called when the user explicitly refreshes or when configuration changes.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  /**
   * Gets the exclude pattern from configuration for VS Code findFiles API.
   * Converts the array of exclude patterns into a format VS Code can use.
   * 
   * @returns A comma-separated string of glob patterns to exclude
   */
  private getExcludePattern(): string {
    const configuration = vscode.workspace.getConfiguration("pkgVersion");
    const excludeFolders: string[] = configuration.get("excludeFolders") || [
      "**/node_modules/**",
      "**/vendor/**",
      "**/venv/**",
      "**/.git/**",
      "**/build/**",
      "**/.dart_tool/**"
    ];
    
    // For VS Code findFiles, return a single pattern if there's only one
    // Otherwise, return a comma-separated list which VS Code handles properly
    return excludeFolders.join(",");
  }

  /**
   * Determines if a file is in an excluded directory.
   * Provides more fine-grained control than VS Code's built-in glob handling.
   * 
   * @param filePath - The full path of the file to check
   * @returns true if the file is in an excluded directory, false otherwise
   */
  private isFileExcluded(filePath: string): boolean {
    const configuration = vscode.workspace.getConfiguration("pkgVersion");
    const excludeFolders: string[] = configuration.get("excludeFolders") || [];
    
    // Normalize path for consistent comparison (use forward slashes)
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Check common exclusions first for performance (most common use case)
    if (normalizedPath.includes('/node_modules/')) {
      return true;
    }
    
    // Check if the path matches any exclude pattern
    for (const pattern of excludeFolders) {
      // Convert glob pattern to a regex pattern
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')       // ** becomes .* (any characters)
        .replace(/\*/g, '[^/]*')      // * becomes [^/]* (any characters except /)
        .replace(/\?/g, '[^/]')       // ? becomes [^/] (any single character except /)
        .replace(/\./g, '\\.')        // Escape dots
        .replace(/\//g, '\\/');       // Escape slashes
      
      try {
        const regex = new RegExp(regexPattern, 'i'); // Case insensitive
        if (regex.test(normalizedPath)) {
          return true;
        }
      } catch (e) {
        // If regex creation fails, fall back to simple include check
        // Remove glob patterns and check for path inclusion
        const simplePattern = pattern
          .replace(/\*\*/g, '')
          .replace(/\*/g, '')
          .replace(/\?/g, '')
          .replace(/^\/+|\/+$/g, '');
          
        if (simplePattern && normalizedPath.includes(simplePattern)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Gets the children of a tree item - either package files at the root level
   * or dependencies for a specific package file.
   * 
   * @param element - The parent element, or undefined for root level
   * @returns Promise resolving to array of dependency items
   * 
   * TODO: Add support for multi-root workspaces
   */
  async getChildren(element?: Dependency): Promise<Dependency[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage("No workspace open")
      return Promise.resolve([])
    }

    if (element && element.resourceUri) {
      // If we have an element (a package file), parse it based on its type
      const filePath = element.resourceUri.fsPath
      
      // Skip excluded files
      if (this.isFileExcluded(filePath)) {
        console.log(`Skipping excluded file: ${filePath}`);
        return Promise.resolve([]);
      }
      
      // Use await since the parsing functions are now async
      if (filePath.endsWith("package.json")) {
        // Now returns Promise<Dependency[]>
        return await this.getDepsInPackageJson(element.resourceUri)
      } else if (filePath.endsWith("composer.json")) {
        return await this.getDepsInComposerJson(element.resourceUri)
      } else if (filePath.endsWith("requirements.txt")) {
        return await this.getDepsInRequirementsTxt(element.resourceUri)
      } else if (filePath.endsWith("pubspec.yaml")) {
        return await this.getDepsInPubspecYaml(element.resourceUri)
      } else {
        // Should not happen based on findFiles pattern, but handle defensively
        return Promise.resolve([])
      }
    } else {
      // If no element, we are at the root. Find compatible package files in the workspace.
      const patterns = [
        "**/package.json",
        "**/composer.json",
        "**/requirements.txt",
        "**/pubspec.yaml",
      ]
      
      // TODO: Add support for more package managers (Cargo.toml, go.mod, etc.)
      
      // Get exclude pattern for VS Code findFiles
      const excludePattern = this.getExcludePattern();
      console.log(`Searching with exclude pattern: ${excludePattern}`);
      
      // First apply the VS Code's built-in findFiles exclusion
      return vscode.workspace
        .findFiles(`{${patterns.join(",")}}`, excludePattern)
        .then((uris) => {
          console.log(`Found ${uris.length} package files before filtering`);
          
          // Then apply our custom exclusion logic as a secondary filter
          // This is needed because VS Code's glob pattern handling sometimes doesn't 
          // exclude everything we want
          const filteredUris = uris.filter(uri => {
            const excluded = this.isFileExcluded(uri.fsPath);
            if (excluded) {
              console.log(`Additional filtering: excluded ${uri.fsPath}`);
            }
            return !excluded;
          });
          
          console.log(`Filtered to ${filteredUris.length} package files after custom exclusion`);
          return filteredUris.map((uri) => {
            const relativePath = vscode.workspace.asRelativePath(uri)
            // Pass the uri to the Dependency constructor
            return new Dependency(
              relativePath,
              "",
              vscode.TreeItemCollapsibleState.Collapsed,
              uri
            )
          })
        })
    }
  }

  /**
   * Parses a package.json file and extracts all dependencies with their versions.
   * For each dependency, fetches the latest version from npm registry and
   * determines the update type.
   * 
   * @param packageJsonUri - URI of the package.json file
   * @returns Promise resolving to array of dependencies
   */
  private async getDepsInPackageJson(
    packageJsonUri: vscode.Uri
  ): Promise<Dependency[]> {
    // Return Promise<Dependency[]>
    if (!this.pathExists(packageJsonUri.fsPath)) {
      return Promise.resolve([])
    }
    try {
      const buffer = await vscode.workspace.fs.readFile(packageJsonUri)
      const content = Buffer.from(buffer).toString("utf8")
      const json = JSON.parse(content)
      let depsPromises: Promise<Dependency | null>[] = [] // Store promises

      const processDependencies = async (
        dependencies: { [key: string]: string } | undefined
      ) => {
        if (!dependencies) return

        for (const moduleName of Object.keys(dependencies)) {
          const currentVersion = dependencies[moduleName]
          // Push the promise for creating the dependency
          depsPromises.push(
            (async () => {
              const latestVersion = await fetchLatestNpmVersion(moduleName)
              if (latestVersion) {
                const updateType = getUpdateType(currentVersion, latestVersion)
                return new Dependency(
                  moduleName,
                  currentVersion,
                  vscode.TreeItemCollapsibleState.None,
                  undefined, // No resourceUri for individual deps
                  latestVersion,
                  updateType,
                  "npm",
                  packageJsonUri.fsPath
                )
              } else {
                // If fetch failed, create dependency without update info
                return new Dependency(
                  moduleName,
                  currentVersion,
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  undefined,
                  "none",
                  "npm",
                  packageJsonUri.fsPath
                )
              }
            })()
          )
        }
      }

      await processDependencies(json.dependencies)
      await processDependencies(json.devDependencies)
      // TODO: Add support for other dependency types (peerDependencies, optionalDependencies)

      // Wait for all dependency fetch/creation promises to resolve
      const resolvedDeps = await Promise.all(depsPromises)
      // Filter out any null results (though currently not returning null)
      return resolvedDeps.filter((d): d is Dependency => d !== null)
    } catch (err: any) {
      console.error(`Error reading or parsing ${packageJsonUri.fsPath}:`, err)
      vscode.window.showErrorMessage(
        `Failed to read dependencies from ${vscode.workspace.asRelativePath(
          packageJsonUri
        )}`
      )
      return [] // Return empty array on error
    }
  }

  /**
   * Parses a composer.json file and extracts all dependencies with their versions.
   * For each dependency, fetches the latest version from Packagist and
   * determines the update type.
   * 
   * @param composerJsonUri - URI of the composer.json file
   * @returns Promise resolving to array of dependencies
   */
  private async getDepsInComposerJson(
    composerJsonUri: vscode.Uri
  ): Promise<Dependency[]> {
    if (!this.pathExists(composerJsonUri.fsPath)) {
      return Promise.resolve([])
    }
    try {
      const buffer = await vscode.workspace.fs.readFile(composerJsonUri)
      const content = Buffer.from(buffer).toString("utf8")
      const json = JSON.parse(content)
      let depsPromises: Promise<Dependency | null>[] = []

      const processComposerDependencies = async (
        dependencies: { [key: string]: string } | undefined
      ) => {
        if (!dependencies) return

        for (const moduleName of Object.keys(dependencies)) {
          const currentVersion = dependencies[moduleName]

          // Filter out php and extensions before fetching
          if (
            moduleName.toLowerCase() === "php" ||
            moduleName.startsWith("ext-")
          ) {
            continue // Skip platform requirements
          }

          depsPromises.push(
            (async () => {
              const latestVersion = await fetchLatestPackagistVersion(
                moduleName
              )
              if (latestVersion) {
                // Note: Composer version constraints can be complex (^, ~, >).
                // getUpdateType uses basic semver comparison. More robust check might be needed.
                const updateType = getUpdateType(currentVersion, latestVersion)
                return new Dependency(
                  moduleName,
                  currentVersion,
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  latestVersion,
                  updateType,
                  "composer",
                  composerJsonUri.fsPath
                )
              } else {
                return new Dependency(
                  moduleName,
                  currentVersion,
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  undefined,
                  "none",
                  "composer",
                  composerJsonUri.fsPath
                )
              }
            })()
          )
        }
      }

      await processComposerDependencies(json.require)
      await processComposerDependencies(json["require-dev"])
      
      // TODO: Add support for additional Composer dependency sections

      const resolvedDeps = await Promise.all(depsPromises)
      return resolvedDeps.filter((d): d is Dependency => d !== null)
    } catch (err: any) {
      console.error(`Error reading or parsing ${composerJsonUri.fsPath}:`, err)
      vscode.window.showErrorMessage(
        `Failed to read dependencies from ${vscode.workspace.asRelativePath(
          composerJsonUri
        )}`
      )
      return []
    }
  }

  /**
   * Parses a requirements.txt file and extracts all Python dependencies.
   * For each dependency, fetches the latest version from PyPI and
   * determines the update type.
   * 
   * @param requirementsTxtUri - URI of the requirements.txt file
   * @returns Promise resolving to array of dependencies
   * 
   * TODO: Improve parsing of complex requirements.txt formats
   * (e.g., editable installs, URL dependencies, environment markers)
   */
  private async getDepsInRequirementsTxt(
    requirementsTxtUri: vscode.Uri
  ): Promise<Dependency[]> {
    if (!this.pathExists(requirementsTxtUri.fsPath)) {
      return Promise.resolve([])
    }
    try {
      const buffer = await vscode.workspace.fs.readFile(requirementsTxtUri)
      const content = Buffer.from(buffer).toString("utf8")
      const lines = content.split(/\r?\n/) // Split by newline, handling CRLF and LF
      const depsPromises: Promise<Dependency | null>[] = []

      for (const line of lines) {
        const trimmedLine = line.trim()
        // Skip empty lines and comments
        if (trimmedLine && !trimmedLine.startsWith("#")) {
          // Ignore lines with options like -r, -e, --hash, or local paths starting with .
          if (trimmedLine.startsWith("-") || trimmedLine.startsWith("."))
            continue

          // Basic parsing: assumes format like package==version, package>=version, package
          // More robust parsing might be needed for complex cases (e.g., URLs, extras)
          const match = trimmedLine.match(/^([^=><!~\s]+)\s*([=><!~]=?.*)?/)
          if (match) {
            const name = match[1].trim()
            // Version specifier might be complex (e.g., >=1.0,<2.0).
            // For simplicity, we'll pass the whole specifier as 'currentVersion'.
            // A more accurate comparison would require parsing the specifier.
            const currentVersion = match[2] ? match[2].trim() : "latest"

            depsPromises.push(
              (async () => {
                const latestVersion = await fetchLatestPypiVersion(name)
                if (latestVersion) {
                  // Note: currentVersion here is the *specifier*, not necessarily a fixed version.
                  // getUpdateType might not be accurate if currentVersion is a range.
                  // For a simple indicator, we compare against the latest available.
                  const updateType = getUpdateType(
                    currentVersion,
                    latestVersion
                  )
                  return new Dependency(
                    name,
                    currentVersion, // Show the original specifier
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    latestVersion,
                    updateType,
                    "pypi",
                    requirementsTxtUri.fsPath
                  )
                } else {
                  return new Dependency(
                    name,
                    currentVersion,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    undefined,
                    "none",
                    "pypi",
                    requirementsTxtUri.fsPath
                  )
                }
              })()
            )
          }
        }
      }
      const resolvedDeps = await Promise.all(depsPromises)
      return resolvedDeps.filter((d): d is Dependency => d !== null)
    } catch (err: any) {
      console.error(
        `Error reading or parsing ${requirementsTxtUri.fsPath}:`,
        err
      )
      vscode.window.showErrorMessage(
        `Failed to read dependencies from ${vscode.workspace.asRelativePath(
          requirementsTxtUri
        )}`
      )
      return []
    }
  }

  /**
   * Parses a pubspec.yaml file and extracts all Dart/Flutter dependencies.
   * For each dependency, fetches the latest version from Pub.dev and
   * determines the update type.
   * 
   * Handles various types of dependencies including:
   * - Version constraints (>=1.0.0 <2.0.0)
   * - SDK dependencies (sdk: flutter)
   * - Path dependencies (path: ../my_package)
   * - Git dependencies (git: {url: ...})
   * 
   * @param pubspecYamlUri - URI of the pubspec.yaml file
   * @returns Promise resolving to array of dependencies
   */
  private async getDepsInPubspecYaml(
    pubspecYamlUri: vscode.Uri
  ): Promise<Dependency[]> {
    if (!this.pathExists(pubspecYamlUri.fsPath)) {
      return Promise.resolve([])
    }
    try {
      const buffer = await vscode.workspace.fs.readFile(pubspecYamlUri)
      const content = Buffer.from(buffer).toString("utf8")
      const doc = yaml.load(content) as any // Use 'as any' for simplicity
      let depsPromises: Promise<Dependency | null>[] = []

      const processPubspecDependencies = async (
        dependencies: { [key: string]: any } | undefined
      ) => {
        if (!dependencies) return

        for (const moduleName of Object.keys(dependencies)) {
          const versionData = dependencies[moduleName]

          // Skip flutter_sdk dependency and path/git dependencies for version checking
          if (
            (moduleName === "flutter" && versionData?.sdk === "flutter") ||
            versionData?.path ||
            versionData?.git
          ) {
            let versionStr = ""
            if (typeof versionData === "string") {
              versionStr = versionData
            } else if (versionData?.sdk) {
              versionStr = `sdk: ${versionData.sdk}`
            } else if (versionData?.path) {
              versionStr = `path: ${versionData.path}`
            } else if (versionData?.git) {
              versionStr =
                typeof versionData.git === "string"
                  ? `git: ${versionData.git}`
                  : `git: ${versionData.git.url}`
            } else {
              versionStr = JSON.stringify(versionData) // Fallback
            }
            // Create dependency item without fetching latest version for these types
            depsPromises.push(
              Promise.resolve(
                new Dependency(
                  moduleName,
                  versionStr,
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  undefined,
                  "none",
                  undefined,
                  pubspecYamlUri.fsPath
                )
              )
            )
            continue // Skip fetching for sdk/path/git
          }

          let currentVersion = "any" // Default if version is not a string
          if (typeof versionData === "string") {
            currentVersion = versionData
          } else if (typeof versionData === "object" && versionData !== null) {
            // Handle cases where version might be an empty object or similar
            // If it's not path/git/sdk, it's likely just constraints, treat as 'any' for now
            // More complex parsing could extract constraints if needed.
            currentVersion = JSON.stringify(versionData) // Show the object as string
          }

          depsPromises.push(
            (async () => {
              const latestVersion = await fetchLatestPubDevVersion(moduleName)
              if (latestVersion) {
                // Pubspec versions often use caret syntax (^). getUpdateType handles basic comparison.
                const updateType = getUpdateType(currentVersion, latestVersion)
                return new Dependency(
                  moduleName,
                  currentVersion,
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  latestVersion,
                  updateType,
                  "pubdev",
                  pubspecYamlUri.fsPath
                )
              } else {
                return new Dependency(
                  moduleName,
                  currentVersion,
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  undefined,
                  "none",
                  "pubdev",
                  pubspecYamlUri.fsPath
                )
              }
            })()
          )
        }
      }

      await processPubspecDependencies(doc?.dependencies)
      await processPubspecDependencies(doc?.dev_dependencies)
      // TODO: Add support for dependency_overrides section

      const resolvedDeps = await Promise.all(depsPromises)
      return resolvedDeps.filter((d): d is Dependency => d !== null)
    } catch (err: any) {
      console.error(`Error reading or parsing ${pubspecYamlUri.fsPath}:`, err)
      // Check if it's a YAMLException for a more specific message
      if (err.name === "YAMLException") {
        vscode.window.showErrorMessage(
          `Failed to parse YAML in ${vscode.workspace.asRelativePath(
            pubspecYamlUri
          )}: ${err.message}`
        )
      } else {
        vscode.window.showErrorMessage(
          `Failed to read dependencies from ${vscode.workspace.asRelativePath(
            pubspecYamlUri
          )}`
        )
      }
      return []
    }
  }

  /**
   * Updates a package to its latest version in the corresponding manifest file.
   * Supports package.json, composer.json, requirements.txt, and pubspec.yaml.
   * 
   * @param dependency - The dependency to update
   * @returns A promise that resolves when the update is complete
   */
  async updatePackage(dependency: Dependency): Promise<boolean> {
    if (!dependency.packageManager || !dependency.latestVersion) {
      vscode.window.showErrorMessage("Cannot update this package: missing package manager or latest version information");
      return false;
    }

    try {
      switch (dependency.packageManager) {
        case "npm":
          return await this.updateNpmPackage(dependency);
        case "composer":
          return await this.updateComposerPackage(dependency);
        case "pypi":
          return await this.updatePypiPackage(dependency);
        case "pubdev":
          return await this.updatePubDevPackage(dependency);
        default:
          vscode.window.showErrorMessage(`Updating packages for ${dependency.packageManager} is not supported yet.`);
          return false;
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to update package ${dependency.label}: ${error.message}`);
      console.error("Package update failed:", error);
      return false;
    }
  }

  /**
   * Updates an npm package in package.json.
   * 
   * @param dependency - The npm dependency to update
   * @returns True if the update was successful, false otherwise
   */
  private async updateNpmPackage(dependency: Dependency): Promise<boolean> {
    if (!dependency.parentFile) {
      // Find the package.json from workspace
      const packageJsonFiles = await vscode.workspace.findFiles(
        "**/package.json",
        this.getExcludePattern()
      );
      
      if (packageJsonFiles.length === 0) {
        vscode.window.showErrorMessage("No package.json file found in the workspace");
        return false;
      }
      
      if (packageJsonFiles.length > 1) {
        // If multiple package.json files, let user choose which one to update
        const items = packageJsonFiles.map((file) => ({
          label: vscode.workspace.asRelativePath(file),
          file
        }));
        
        const selection = await vscode.window.showQuickPick(items, {
          placeHolder: "Select package.json file to update"
        });
        
        if (!selection) {
          return false;
        }
        
        return await this.updatePackageJsonDependency(selection.file, dependency);
      } else {
        // Only one package.json, use it
        return await this.updatePackageJsonDependency(packageJsonFiles[0], dependency);
      }
    } else {
      // Use the parent file directly
      return await this.updatePackageJsonDependency(vscode.Uri.file(dependency.parentFile), dependency);
    }
  }

  /**
   * Updates a dependency in a specific package.json file.
   * 
   * @param packageJsonUri - URI of the package.json file
   * @param dependency - The dependency to update
   * @returns True if the update was successful, false otherwise
   */
  private async updatePackageJsonDependency(
    packageJsonUri: vscode.Uri,
    dependency: Dependency
  ): Promise<boolean> {
    try {
      const document = await vscode.workspace.openTextDocument(packageJsonUri);
      const packageJson = JSON.parse(document.getText());
      
      let updated = false;
      
      // Update in dependencies, devDependencies, and optionalDependencies if present
      const sections = ["dependencies", "devDependencies", "optionalDependencies"];
      
      for (const section of sections) {
        if (packageJson[section] && packageJson[section][dependency.label]) {
          const prefix = packageJson[section][dependency.label].match(/^[~^>=<]/)?.[0] || "";
          packageJson[section][dependency.label] = `${prefix}${dependency.latestVersion}`;
          updated = true;
        }
      }
      
      if (!updated) {
        vscode.window.showWarningMessage(`Package ${dependency.label} not found in ${vscode.workspace.asRelativePath(packageJsonUri)}`);
        return false;
      }
      
      // Write the updated package.json back to disk
      const edit = new vscode.WorkspaceEdit();
      const entireRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      
      edit.replace(
        packageJsonUri,
        entireRange,
        JSON.stringify(packageJson, null, 2)
      );
      
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        vscode.window.showInformationMessage(
          `Updated ${dependency.label} to ${dependency.latestVersion}`
        );
        this.refresh(); // Refresh the view
        return true;
      } else {
        vscode.window.showErrorMessage(`Failed to update ${dependency.label}`);
        return false;
      }
    } catch (error: any) {
      console.error("Error updating package.json:", error);
      vscode.window.showErrorMessage(`Error updating package.json: ${error.message}`);
      return false;
    }
  }

  /**
   * Updates a Composer package in composer.json.
   * 
   * @param dependency - The Composer dependency to update
   * @returns True if the update was successful, false otherwise
   */
  private async updateComposerPackage(dependency: Dependency): Promise<boolean> {
    // Similar to npm update, find composer.json and update it
    const composerJsonFiles = await vscode.workspace.findFiles(
      "**/composer.json",
      this.getExcludePattern()
    );
    
    if (composerJsonFiles.length === 0) {
      vscode.window.showErrorMessage("No composer.json file found in the workspace");
      return false;
    }
    
    let targetFile: vscode.Uri;
    
    if (composerJsonFiles.length > 1) {
      // If multiple composer.json files, let user choose which one to update
      const items = composerJsonFiles.map((file) => ({
        label: vscode.workspace.asRelativePath(file),
        file
      }));
      
      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select composer.json file to update"
      });
      
      if (!selection) {
        return false;
      }
      
      targetFile = selection.file;
    } else {
      // Only one composer.json, use it
      targetFile = composerJsonFiles[0];
    }
    
    try {
      const document = await vscode.workspace.openTextDocument(targetFile);
      const composerJson = JSON.parse(document.getText());
      
      let updated = false;
      
      // Update in require and require-dev sections if present
      const sections = ["require", "require-dev"];
      
      for (const section of sections) {
        if (composerJson[section] && composerJson[section][dependency.label]) {
          // Preserve version constraints (^, ~, etc.)
          const currentVersion = composerJson[section][dependency.label];
          const prefix = currentVersion.match(/^[~^>=<]/)?.[0] || "";
          composerJson[section][dependency.label] = `${prefix}${dependency.latestVersion}`;
          updated = true;
        }
      }
      
      if (!updated) {
        vscode.window.showWarningMessage(`Package ${dependency.label} not found in ${vscode.workspace.asRelativePath(targetFile)}`);
        return false;
      }
      
      // Write the updated composer.json back to disk
      const edit = new vscode.WorkspaceEdit();
      const entireRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      
      edit.replace(
        targetFile,
        entireRange,
        JSON.stringify(composerJson, null, 2)
      );
      
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        vscode.window.showInformationMessage(
          `Updated ${dependency.label} to ${dependency.latestVersion}`
        );
        this.refresh(); // Refresh the view
        return true;
      } else {
        vscode.window.showErrorMessage(`Failed to update ${dependency.label}`);
        return false;
      }
    } catch (error: any) {
      console.error("Error updating composer.json:", error);
      vscode.window.showErrorMessage(`Error updating composer.json: ${error.message}`);
      return false;
    }
  }

  /**
   * Updates a Python package in requirements.txt.
   * 
   * @param dependency - The Python dependency to update
   * @returns True if the update was successful, false otherwise
   */
  private async updatePypiPackage(dependency: Dependency): Promise<boolean> {
    const requirementsFiles = await vscode.workspace.findFiles(
      "**/requirements.txt",
      this.getExcludePattern()
    );
    
    if (requirementsFiles.length === 0) {
      vscode.window.showErrorMessage("No requirements.txt file found in the workspace");
      return false;
    }
    
    let targetFile: vscode.Uri;
    
    if (requirementsFiles.length > 1) {
      // If multiple requirements.txt files, let user choose which one to update
      const items = requirementsFiles.map((file) => ({
        label: vscode.workspace.asRelativePath(file),
        file
      }));
      
      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select requirements.txt file to update"
      });
      
      if (!selection) {
        return false;
      }
      
      targetFile = selection.file;
    } else {
      // Only one requirements.txt, use it
      targetFile = requirementsFiles[0];
    }
    
    try {
      const document = await vscode.workspace.openTextDocument(targetFile);
      const textContent = document.getText();
      const lines = textContent.split(/\r?\n/);
      let updated = false;
      
      // Regex to match package specifications with versions
      const packageRegex = new RegExp(
        `^\\s*(${dependency.label})\\s*([<>=!~^].*)?$`,
        "i"
      );
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = packageRegex.exec(line);
        
        if (match) {
          // Keep any comparison operators (==, >=, etc.)
          const operator = line.includes("==") ? "==" : 
                          line.includes(">=") ? ">=" : 
                          line.includes(">") ? ">" : 
                          line.includes("<=") ? "<=" : 
                          line.includes("<") ? "<" : 
                          line.includes("~=") ? "~=" : "==";
          
          lines[i] = `${dependency.label}${operator}${dependency.latestVersion}`;
          updated = true;
          break;
        }
      }
      
      if (!updated) {
        vscode.window.showWarningMessage(`Package ${dependency.label} not found in ${vscode.workspace.asRelativePath(targetFile)}`);
        return false;
      }
      
      // Write the updated requirements.txt back to disk
      const edit = new vscode.WorkspaceEdit();
      const entireRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      
      edit.replace(targetFile, entireRange, lines.join("\n"));
      
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        vscode.window.showInformationMessage(
          `Updated ${dependency.label} to ${dependency.latestVersion}`
        );
        this.refresh(); // Refresh the view
        return true;
      } else {
        vscode.window.showErrorMessage(`Failed to update ${dependency.label}`);
        return false;
      }
    } catch (error: any) {
      console.error("Error updating requirements.txt:", error);
      vscode.window.showErrorMessage(`Error updating requirements.txt: ${error.message}`);
      return false;
    }
  }

  /**
   * Updates a Dart/Flutter package in pubspec.yaml.
   * 
   * @param dependency - The Dart/Flutter dependency to update
   * @returns True if the update was successful, false otherwise
   */
  private async updatePubDevPackage(dependency: Dependency): Promise<boolean> {
    const pubspecFiles = await vscode.workspace.findFiles(
      "**/pubspec.yaml",
      this.getExcludePattern()
    );
    
    if (pubspecFiles.length === 0) {
      vscode.window.showErrorMessage("No pubspec.yaml file found in the workspace");
      return false;
    }
    
    let targetFile: vscode.Uri;
    
    if (pubspecFiles.length > 1) {
      // If multiple pubspec.yaml files, let user choose which one to update
      const items = pubspecFiles.map((file) => ({
        label: vscode.workspace.asRelativePath(file),
        file
      }));
      
      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select pubspec.yaml file to update"
      });
      
      if (!selection) {
        return false;
      }
      
      targetFile = selection.file;
    } else {
      // Only one pubspec.yaml, use it
      targetFile = pubspecFiles[0];
    }
    
    try {
      const document = await vscode.workspace.openTextDocument(targetFile);
      const textContent = document.getText();
      
      // Parse YAML content
      const pubspecYaml: any = yaml.load(textContent);
      let updated = false;
      
      // Update in dependencies and dev_dependencies sections if present
      const sections = ["dependencies", "dev_dependencies", "dependency_overrides"];
      
      for (const section of sections) {
        if (pubspecYaml[section] && pubspecYaml[section][dependency.label]) {
          const currentValue = pubspecYaml[section][dependency.label];
          
          // Handle different formats of dependencies in pubspec.yaml
          if (typeof currentValue === "string") {
            // Simple version string like "^1.0.0"
            const prefix = currentValue.match(/^[~^>=<]/)?.[0] || "";
            pubspecYaml[section][dependency.label] = `${prefix}${dependency.latestVersion}`;
            updated = true;
          } else if (typeof currentValue === "object") {
            // Complex dependency spec (hosted, git, path, etc.)
            if (currentValue.version) {
              const prefix = currentValue.version.match(/^[~^>=<]/)?.[0] || "";
              pubspecYaml[section][dependency.label].version = `${prefix}${dependency.latestVersion}`;
              updated = true;
            }
          }
        }
      }
      
      if (!updated) {
        vscode.window.showWarningMessage(`Package ${dependency.label} not found in ${vscode.workspace.asRelativePath(targetFile)}`);
        return false;
      }
      
      // Convert back to YAML
      const updatedYaml = yaml.dump(pubspecYaml, { lineWidth: -1 });
      
      // Write the updated pubspec.yaml back to disk
      const edit = new vscode.WorkspaceEdit();
      const entireRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      
      edit.replace(targetFile, entireRange, updatedYaml);
      
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        vscode.window.showInformationMessage(
          `Updated ${dependency.label} to ${dependency.latestVersion}`
        );
        this.refresh(); // Refresh the view
        return true;
      } else {
        vscode.window.showErrorMessage(`Failed to update ${dependency.label}`);
        return false;
      }
    } catch (error: any) {
      console.error("Error updating pubspec.yaml:", error);
      vscode.window.showErrorMessage(`Error updating pubspec.yaml: ${error.message}`);
      return false;
    }
  }

  /**
   * Utility function to check if a file path exists.
   * 
   * @param p - The file path to check
   * @returns true if the file exists, false otherwise
   */
  private pathExists(p: string): boolean {
    try {
      fs.accessSync(p)
    } catch (err) {
      return false
    }
    return true
  }

  /**
   * Gets all outdated dependencies across all manifest files.
   * 
   * @returns A promise that resolves to an array of outdated Dependency objects
   */
  async getAllOutdatedDependencies(): Promise<Dependency[]> {
    const outdatedDependencies: Dependency[] = [];
    
    try {
      // Scan all supported package files
      const packageJsonFiles = await vscode.workspace.findFiles(
        "**/package.json",
        this.getExcludePattern()
      );
      
      const composerJsonFiles = await vscode.workspace.findFiles(
        "**/composer.json",
        this.getExcludePattern()
      );
      
      const requirementsTxtFiles = await vscode.workspace.findFiles(
        "**/requirements.txt",
        this.getExcludePattern()
      );
      
      const pubspecYamlFiles = await vscode.workspace.findFiles(
        "**/pubspec.yaml",
        this.getExcludePattern()
      );
      
      // Process each file type
      for (const packageJsonUri of packageJsonFiles) {
        if (this.isFileExcluded(packageJsonUri.fsPath)) {
          continue;
        }
        const deps = await this.getDepsInPackageJson(packageJsonUri);
        // Filter for only outdated dependencies
        const outdated = deps.filter(dep => 
          dep.updateType && 
          dep.updateType !== "none" && 
          dep.latestVersion
        );
        outdatedDependencies.push(...outdated);
      }
      
      for (const composerJsonUri of composerJsonFiles) {
        if (this.isFileExcluded(composerJsonUri.fsPath)) {
          continue;
        }
        const deps = await this.getDepsInComposerJson(composerJsonUri);
        const outdated = deps.filter(dep => 
          dep.updateType && 
          dep.updateType !== "none" && 
          dep.latestVersion
        );
        outdatedDependencies.push(...outdated);
      }
      
      for (const requirementsTxtUri of requirementsTxtFiles) {
        if (this.isFileExcluded(requirementsTxtUri.fsPath)) {
          continue;
        }
        const deps = await this.getDepsInRequirementsTxt(requirementsTxtUri);
        const outdated = deps.filter(dep => 
          dep.updateType && 
          dep.updateType !== "none" && 
          dep.latestVersion
        );
        outdatedDependencies.push(...outdated);
      }
      
      for (const pubspecYamlUri of pubspecYamlFiles) {
        if (this.isFileExcluded(pubspecYamlUri.fsPath)) {
          continue;
        }
        const deps = await this.getDepsInPubspecYaml(pubspecYamlUri);
        const outdated = deps.filter(dep => 
          dep.updateType && 
          dep.updateType !== "none" && 
          dep.latestVersion
        );
        outdatedDependencies.push(...outdated);
      }
    } catch (error: any) {
      console.error("Error getting outdated dependencies:", error);
      vscode.window.showErrorMessage(`Error scanning for outdated dependencies: ${error.message}`);
    }
    
    return outdatedDependencies;
  }
}

/**
 * Represents a dependency item in the tree view.
 * Can be either a package file (root item) or an individual dependency.
 * 
 * Package files:
 * - Have a resourceUri pointing to the file
 * - Have children (dependencies)
 * - Have a contextValue of "packageFile"
 * - Have an open command
 * 
 * Individual dependencies:
 * - Have version information
 * - Have update status
 * - Have icons based on update type
 * - Have a contextValue of "dependency"
 */
class Dependency extends vscode.TreeItem {
  public latestVersion?: string // Store the latest fetched version
  public updateType?: "major" | "minor" | "patch" | "prerelease" | "none" // Store the type of update
  public packageManager?: string // Store the package manager type
  public parentFile?: string // Store the parent file path

  /**
   * Creates a new Dependency tree item.
   * 
   * @param label - Display name (filename or package name)
   * @param version - Version string or constraint
   * @param collapsibleState - Whether the item can be expanded
   * @param resourceUri - For package files, the URI to the file
   * @param latestVersion - Optional latest available version
   * @param updateType - Optional update type classification
   * @param packageManager - Optional package manager type
   * @param parentFile - Optional parent file path
   */
  constructor(
    public readonly label: string, // Filename or package name
    private version: string, // Version or empty string for file
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceUri?: vscode.Uri, // Store Uri for files
    latestVersion?: string, // Add latestVersion parameter
    updateType?: "major" | "minor" | "patch" | "prerelease" | "none", // Add updateType parameter
    packageManager?: string, // Add package manager parameter
    parentFile?: string // Add parent file path parameter
  ) {
    super(label, collapsibleState)
    this.latestVersion = latestVersion
    this.updateType = updateType
    this.packageManager = packageManager
    this.parentFile = parentFile

    // Update tooltip and description to show both current and latest version
    if (latestVersion && updateType && updateType !== "none") {
      this.tooltip = `${this.label}: ${version} → ${latestVersion} (${updateType} update)`
      this.description = `${version} → ${latestVersion}`
    } else {
      this.tooltip = `${this.label}${version ? `: ${version}` : ""}`
      this.description = version
    }
    
    // Set contextValue based on whether this is a package with an update available
    if (updateType && updateType !== "none" && latestVersion) {
      this.contextValue = "dependency"
    }
    
    // Set icon based on updateType using ThemeIcon
    if (this.updateType && this.updateType !== "none") {
      // Different colors for different update types
      if (this.updateType === "major") {
        this.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("errorForeground")
        ) // Red for major updates
      } else if (this.updateType === "minor") {
        this.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("editorWarning.foreground")
        ) // Yellow/orange for minor updates
      } else if (this.updateType === "patch") {
        this.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("editorInfo.foreground")
        ) // Blue for patch updates
      } else {
        this.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("focusBorder")
        ) // Gray for prereleases
      }
    } else {
      this.iconPath = new vscode.ThemeIcon(
        "pass-filled",
        new vscode.ThemeColor("charts.green")
      ) // Green check mark for up-to-date packages
    }

    // Set command for opening the file
    if (this.resourceUri) {
      this.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [this.resourceUri],
      }
    }
  }

  // TODO: Add custom SVG icons instead of ThemeIcons for better visual distinction
  // Example icon path (replace with actual icons)
  // iconPath = {
  //     light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
  //     dark: path.join(__filename, '..', '..', 'resources', 'dark', 'dependency.svg')
  // };
}
