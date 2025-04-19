/**
 * DependencyProvider - VS Code TreeView provider for package dependencies
 *
 * This module implements the core functionality of the pkg-version extension:
 * - Scanning the workspace for package manifest files (package.json, composer.json, etc.)
 * - Parsing dependencies from these files
 * - Fetching latest versions from respective package registries
 * - Determining update status (major, minor, patch)
 * - Presenting dependencies in a TreeView with status indicators
 */

import * as vscode from "vscode";
import * as path from "path";

// Import models
import { Dependency } from "./models/dependency";

// Import utilities
import { getExcludePattern, isFileExcluded, pathExists } from "./utils/fileUtils";

// Import parsers
import { getDepsInPackageJson } from "./parsers/npmParser";
import { getDepsInComposerJson, getDepsFromComposerLock, getDepsFromVendorDirectory } from "./parsers/composerParser";
import { getDepsInRequirementsTxt } from "./parsers/pythonParser";
import { getDepsInPubspecYaml } from "./parsers/dartParser";

// Import updaters
import { updateNpmPackage } from "./updaters/npmUpdater";
import { updateComposerPackage } from "./updaters/composerUpdater";
import { updatePypiPackage } from "./updaters/pythonUpdater";
import { updatePubDevPackage } from "./updaters/dartUpdater";

/**
 * The DependencyProvider class implements a VS Code TreeDataProvider.
 * It scans the workspace for package files and builds a tree of packages and dependencies.
 * The tree shows package files at the root level and their dependencies as children.
 * Dependencies display their current version, latest available version, and update status.
 */
export class DependencyProvider implements vscode.TreeDataProvider<Dependency> {
  constructor(private workspaceRoot: string | undefined) {}

  getTreeItem(element: Dependency): vscode.TreeItem {
    // Apply special styling to category nodes
    if (element.children) {
      // Set formatting for category headers
      element.iconPath = new vscode.ThemeIcon(
        "folder",
        new vscode.ThemeColor("charts.blue")
      );
      
      // Add the number of dependencies to the description
      element.description = `(${element.children.length})`;
    }
    
    return element;
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    Dependency | undefined | null | void
  > = new vscode.EventEmitter<Dependency | undefined | null | void>();

  readonly onDidChangeTreeData: vscode.Event<
    Dependency | undefined | null | void
  > = this._onDidChangeTreeData.event;

  /**
   * Refreshes the dependency tree view.
   * Triggers a reload of all dependencies.
   */
  refresh(): void {
    // Clear any cached data
    this._cachedDependencies = undefined;

    // Notify that the tree data has changed, triggering a refresh
    this._onDidChangeTreeData.fire();

    // Log refresh for debugging
    console.log("Dependency tree refreshed");
  }

  // Add a private field to store cached dependencies
  private _cachedDependencies?: Map<string, Dependency[]>;

  /**
   * Gets the children of a tree item - either package files at the root level
   * or dependencies for a specific package file.
   *
   * @param element - The parent element, or undefined for root level
   * @returns Promise resolving to array of dependency items
   */
  async getChildren(element?: Dependency): Promise<Dependency[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage("No workspace open");
      return Promise.resolve([]);
    }

    // If element is a category node, return its children
    if (element && element.children) {
      return element.children;
    }

    if (element && element.resourceUri) {
      // If we have an element (a package file), parse it based on its type
      const filePath = element.resourceUri.fsPath;

      // Skip excluded files
      if (isFileExcluded(filePath)) {
        console.log(`Skipping excluded file: ${filePath}`);
        return Promise.resolve([]);
      }

      // Use await since the parsing functions are now async
      let allDependencies: Dependency[] = [];
      
      if (filePath.endsWith("package.json")) {
        allDependencies = await getDepsInPackageJson(element.resourceUri);
      } else if (filePath.endsWith("composer.json")) {
        allDependencies = await getDepsInComposerJson(element.resourceUri);
      } else if (filePath.endsWith("requirements.txt")) {
        allDependencies = await getDepsInRequirementsTxt(element.resourceUri);
      } else if (filePath.endsWith("pubspec.yaml")) {
        allDependencies = await getDepsInPubspecYaml(element.resourceUri);
      } else if (
        filePath.endsWith("vendor") ||
        path.basename(path.dirname(filePath)) === "vendor"
      ) {
        // If this is a vendor directory, scan it for Composer packages
        allDependencies = await getDepsFromVendorDirectory(element.resourceUri);
      } else if (filePath.endsWith("composer.lock")) {
        // Add support for viewing dependencies directly from composer.lock
        allDependencies = await getDepsFromComposerLock(element.resourceUri);
      } else {
        // Should not happen based on findFiles pattern, but handle defensively
        return Promise.resolve([]);
      }
      
      // Separate dependencies into regular and dev dependencies
      const regularDeps = allDependencies.filter(dep => !dep.isDevDependency);
      const devDeps = allDependencies.filter(dep => dep.isDevDependency);
      
      // If we have both types of dependencies, create category items
      if (regularDeps.length > 0 && devDeps.length > 0) {
        const result: Dependency[] = [];
        
        // Add "Dependencies" category
        if (regularDeps.length > 0) {
          const depsCategoryItem = new Dependency(
            "Dependencies",
            "",
            vscode.TreeItemCollapsibleState.Expanded
          );
          depsCategoryItem.children = regularDeps;
          result.push(depsCategoryItem);
        }
        
        // Add "Dev Dependencies" category
        if (devDeps.length > 0) {
          const devDepsCategoryItem = new Dependency(
            "Dev Dependencies",
            "",
            vscode.TreeItemCollapsibleState.Expanded
          );
          devDepsCategoryItem.children = devDeps;
          result.push(devDepsCategoryItem);
        }
        
        return result;
      }
      
      // If we only have one type, return them directly without categories
      return allDependencies;
    } else {
      // If no element, we are at the root. Find compatible package files in the workspace.
      const patterns: string[] = [];

      // Get configuration settings
      const configuration = vscode.workspace.getConfiguration("pkgVersion");
      const scanVendorDirectory = configuration.get(
        "scanVendorDirectory",
        true
      );
      const composerPackageDetection = configuration.get(
        "composerPackageDetection",
        "auto"
      );

      // Always include these patterns
      patterns.push("**/package.json");
      patterns.push("**/requirements.txt");
      patterns.push("**/pubspec.yaml");

      // Conditionally include composer patterns based on composerPackageDetection setting
      if (["auto", "composer.json", "all"].includes(composerPackageDetection)) {
        patterns.push("**/composer.json");
      }

      if (["auto", "composer.lock", "all"].includes(composerPackageDetection)) {
        patterns.push("**/composer.lock");
      }

      if (
        ["auto", "vendor", "all"].includes(composerPackageDetection) &&
        scanVendorDirectory
      ) {
        patterns.push("**/vendor");
      }

      // Get exclude pattern for VS Code findFiles
      const excludePattern = getExcludePattern();
      console.log(`Searching with exclude pattern: ${excludePattern}`);

      // Special handling for vendor directories - we need to exclude them from the general exclude pattern
      let modifiedExcludePattern = excludePattern;
      if (
        scanVendorDirectory &&
        ["auto", "vendor", "all"].includes(composerPackageDetection)
      ) {
        const excludePatternsWithoutVendor = excludePattern
          .split(",")
          .filter((pattern) => !pattern.includes("vendor"));
        modifiedExcludePattern = excludePatternsWithoutVendor.join(",");
      }

      // Log current exclusion patterns for debugging
      console.log(`Using VS Code exclude pattern: ${modifiedExcludePattern}`);
      console.log(`Scanning for file patterns: ${patterns.join(", ")}`);

      // First apply the VS Code's built-in findFiles exclusion
      return vscode.workspace
        .findFiles(`{${patterns.join(",")}}`, modifiedExcludePattern)
        .then(async (uris) => {
          console.log(`Found ${uris.length} package files before filtering`);

          // Then apply our custom exclusion logic as a secondary filter
          // This is needed because VS Code's glob pattern handling sometimes doesn't
          // exclude everything we want, but make an exception for vendor directories
          const filteredUris = uris.filter((uri) => {
            const isVendor =
              uri.fsPath.endsWith("vendor") ||
              path.basename(path.dirname(uri.fsPath)) === "vendor";
            const excluded =
              (!scanVendorDirectory || !isVendor) &&
              isFileExcluded(uri.fsPath);
            if (excluded) {
              console.log(`Additional filtering: excluded ${uri.fsPath}`);
            }
            return !excluded;
          });

          console.log(
            `Filtered to ${filteredUris.length} package files after custom exclusion`
          );

          // Convert URIs to Dependency objects
          const packageFiles = filteredUris.map((uri) => {
            const relativePath = vscode.workspace.asRelativePath(uri);
            // Pass the uri to the Dependency constructor
            return new Dependency(
              relativePath,
              "",
              vscode.TreeItemCollapsibleState.Collapsed,
              uri
            );
          });

          // Auto-scan Composer projects if needed
          if (
            ["auto", "all"].includes(composerPackageDetection) &&
            this.workspaceRoot
          ) {
            // Determine what Composer files we've already found
            const hasComposerJson = packageFiles.some((dep) =>
              dep.resourceUri?.fsPath.endsWith("composer.json")
            );
            const hasComposerLock = packageFiles.some((dep) =>
              dep.resourceUri?.fsPath.endsWith("composer.lock")
            );
            const hasVendorDir = packageFiles.some((dep) =>
              dep.resourceUri?.fsPath.endsWith("vendor")
            );

            // If we need certain files that weren't found yet, try to find them in the workspace root
            if (
              !hasComposerJson &&
              ["auto", "composer.json", "all"].includes(
                composerPackageDetection
              )
            ) {
              const rootComposerJsonPath = path.join(
                this.workspaceRoot,
                "composer.json"
              );
              if (pathExists(rootComposerJsonPath)) {
                const rootComposerJsonUri =
                  vscode.Uri.file(rootComposerJsonPath);
                const relativePath =
                  vscode.workspace.asRelativePath(rootComposerJsonUri);
                packageFiles.push(
                  new Dependency(
                    relativePath,
                    "",
                    vscode.TreeItemCollapsibleState.Collapsed,
                    rootComposerJsonUri
                  )
                );
              }
            }

            if (
              !hasComposerLock &&
              ["auto", "composer.lock", "all"].includes(
                composerPackageDetection
              )
            ) {
              const rootComposerLockPath = path.join(
                this.workspaceRoot,
                "composer.lock"
              );
              if (pathExists(rootComposerLockPath)) {
                const rootComposerLockUri =
                  vscode.Uri.file(rootComposerLockPath);
                const relativePath =
                  vscode.workspace.asRelativePath(rootComposerLockUri);
                packageFiles.push(
                  new Dependency(
                    relativePath,
                    "",
                    vscode.TreeItemCollapsibleState.Collapsed,
                    rootComposerLockUri
                  )
                );
              }
            }

            if (
              !hasVendorDir &&
              scanVendorDirectory &&
              ["auto", "vendor", "all"].includes(composerPackageDetection)
            ) {
              const rootVendorPath = path.join(this.workspaceRoot, "vendor");
              if (pathExists(rootVendorPath)) {
                const rootVendorUri = vscode.Uri.file(rootVendorPath);
                const relativePath =
                  vscode.workspace.asRelativePath(rootVendorUri);
                packageFiles.push(
                  new Dependency(
                    relativePath,
                    "",
                    vscode.TreeItemCollapsibleState.Collapsed,
                    rootVendorUri
                  )
                );
              }
            }
          }

          return packageFiles;
        });
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
      vscode.window.showErrorMessage(
        "Cannot update this package: missing package manager or latest version information"
      );
      return false;
    }

    try {
      switch (dependency.packageManager) {
        case "npm":
          return await updateNpmPackage(dependency);
        case "composer":
          return await updateComposerPackage(dependency);
        case "pypi":
          return await updatePypiPackage(dependency);
        case "dart":
          return await updatePubDevPackage(dependency);
        default:
          vscode.window.showErrorMessage(
            `Updating packages for ${dependency.packageManager} is not supported yet.`
          );
          return false;
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to update package ${dependency.label}: ${error.message}`
      );
      console.error("Package update failed:", error);
      return false;
    }
  }

  /**
   * Gets all outdated dependencies across all manifest files.
   *
   * @returns A promise that resolves to an array of outdated Dependency objects
   */
  async getAllOutdatedDependencies(): Promise<Dependency[]> {
    const outdatedDependencies: Dependency[] = [];

    try {
      // Log that we're starting to scan for outdated dependencies
      console.log("Scanning for outdated dependencies...");
      
      // Get the exclude pattern for VS Code findFiles
      const excludePattern = getExcludePattern();
      console.log(`Using exclude pattern for outdated scan: ${excludePattern}`);

      // Scan all supported package files
      const packageJsonFiles = await vscode.workspace.findFiles(
        "**/package.json",
        excludePattern
      );

      const composerJsonFiles = await vscode.workspace.findFiles(
        "**/composer.json",
        excludePattern
      );

      const requirementsTxtFiles = await vscode.workspace.findFiles(
        "**/requirements.txt",
        excludePattern
      );

      const pubspecYamlFiles = await vscode.workspace.findFiles(
        "**/pubspec.yaml",
        excludePattern
      );

      console.log(`Found ${packageJsonFiles.length} package.json files`);
      console.log(`Found ${composerJsonFiles.length} composer.json files`);
      console.log(`Found ${requirementsTxtFiles.length} requirements.txt files`);
      console.log(`Found ${pubspecYamlFiles.length} pubspec.yaml files`);

      // Process each file type
      for (const packageJsonUri of packageJsonFiles) {
        if (isFileExcluded(packageJsonUri.fsPath)) {
          console.log(`Skipping excluded package.json: ${packageJsonUri.fsPath}`);
          continue;
        }
        const deps = await getDepsInPackageJson(packageJsonUri);
        // Filter for only outdated dependencies
        const outdated = deps.filter(
          (dep) =>
            dep.updateType && dep.updateType !== "none" && dep.latestVersion
        );
        outdatedDependencies.push(...outdated);
      }

      for (const composerJsonUri of composerJsonFiles) {
        if (isFileExcluded(composerJsonUri.fsPath)) {
          continue;
        }
        const deps = await getDepsInComposerJson(composerJsonUri);
        const outdated = deps.filter(
          (dep) =>
            dep.updateType && dep.updateType !== "none" && dep.latestVersion
        );
        outdatedDependencies.push(...outdated);
      }

      for (const requirementsTxtUri of requirementsTxtFiles) {
        if (isFileExcluded(requirementsTxtUri.fsPath)) {
          continue;
        }
        const deps = await getDepsInRequirementsTxt(requirementsTxtUri);
        const outdated = deps.filter(
          (dep) =>
            dep.updateType && dep.updateType !== "none" && dep.latestVersion
        );
        outdatedDependencies.push(...outdated);
      }

      for (const pubspecYamlUri of pubspecYamlFiles) {
        if (isFileExcluded(pubspecYamlUri.fsPath)) {
          continue;
        }
        const deps = await getDepsInPubspecYaml(pubspecYamlUri);
        const outdated = deps.filter(
          (dep) =>
            dep.updateType && dep.updateType !== "none" && dep.latestVersion
        );
        outdatedDependencies.push(...outdated);
      }
    } catch (error: any) {
      console.error("Error getting outdated dependencies:", error);
      vscode.window.showErrorMessage(
        `Error scanning for outdated dependencies: ${error.message}`
      );
    }

    return outdatedDependencies;
  }
} 