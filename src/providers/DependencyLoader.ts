/**
 * DependencyLoader - Loads dependencies from manifest files
 * Implements lazy loading: shows dependencies immediately, fetches versions in background
 */

import * as vscode from "vscode";
import * as path from "path";
import { Dependency } from "../models/dependency";
import { isFileExcluded, getExcludePattern } from "../utils/fileUtils";
import { getDepsInPackageJson } from "../parsers/npmParser";
import { getDepsInComposerJson, getDepsFromComposerLock, getDepsFromVendorDirectory } from "../parsers/composerParser";
import { getDepsInRequirementsTxt } from "../parsers/pythonParser";
import { getDepsInPubspecYaml } from "../parsers/dartParser";
import { getDepsInPyprojectToml } from "../parsers/poetryParser";
import { getDepsInCargoToml } from "../parsers/cargoParser";

export class DependencyLoader {
  private _loadingQueue: Map<string, boolean> = new Map();
  private _loadedFiles: Set<string> = new Set();
  private _dependencyCache: Map<string, Dependency[]> = new Map();

  constructor(
    private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined | null | void>
  ) {}

  clearCache(): void {
    console.log("[DependencyLoader] Clearing all caches");
    this._loadingQueue.clear();
    this._loadedFiles.clear();
    this._dependencyCache.clear();
  }

  async loadDependenciesForManifest(element: Dependency): Promise<Dependency[]> {
    if (!element.resourceUri) {
      return [];
    }

    const filePath = element.resourceUri.fsPath;

    // Skip excluded files immediately
    if (isFileExcluded(filePath)) {
      console.log(`[DependencyLoader] Skipping excluded file: ${filePath}`);
      return [];
    }

    // Check cache first - return cached dependencies if available
    const cached = this._dependencyCache.get(filePath);
    if (cached) {
      console.log(`[DependencyLoader] Returning cached dependencies for: ${filePath} (${cached.length} items)`);
      return cached;
    }

    console.log(`[DependencyLoader] Loading dependencies for: ${filePath}`);

    const isLoading = this._loadingQueue.get(filePath);
    
    // If already loading, return cached if available, otherwise empty
    if (isLoading) {
      console.log(`[DependencyLoader] Already loading ${filePath}, returning cached or empty`);
      return cached || [];
    }

    let allDependencies: Dependency[] = [];

    try {
      // Parse dependencies based on file type (NO VERSION FETCHING)
      console.log(`[DependencyLoader] Parsing dependencies (no version fetch)...`);
      allDependencies = await this.parseDependenciesFromFile(filePath, element.resourceUri);
      console.log(`[DependencyLoader] Parsed ${allDependencies.length} dependencies`);

      // Build the tree structure with categories
      const treeStructure = this.buildDependencyTree(filePath, allDependencies);
      
      // Cache the result - NOTE: The dependency objects in the tree will be updated in-place
      // by the background version loader, so the cache will automatically have updated data
      this._dependencyCache.set(filePath, treeStructure);
      
      // Mark this file as loaded
      this._loadedFiles.add(filePath);

      // Start loading versions in background if not already loading
      console.log(`[DependencyLoader] Starting background version loading for ${allDependencies.length} dependencies`);
      this._loadingQueue.set(filePath, true);
      // DO NOT AWAIT - this runs in background
      this.loadVersionsInBackground(filePath, allDependencies);

      return treeStructure;
    } catch (error) {
      console.error(`[DependencyLoader] Error parsing dependencies from ${filePath}:`, error);
      return [];
    }
  }

  private async parseDependenciesFromFile(
    filePath: string,
    resourceUri: vscode.Uri
  ): Promise<Dependency[]> {
    if (filePath.endsWith("package.json")) {
      const deps = await getDepsInPackageJson(resourceUri);
      console.log(`Parsed ${deps.length} dependencies from package.json`);
      return deps;
    } else if (filePath.endsWith("composer.json")) {
      return getDepsInComposerJson(resourceUri);
    } else if (filePath.endsWith("requirements.txt")) {
      return getDepsInRequirementsTxt(resourceUri);
    } else if (filePath.endsWith("pyproject.toml")) {
      return getDepsInPyprojectToml(resourceUri);
    } else if (filePath.endsWith("Cargo.toml")) {
      return getDepsInCargoToml(resourceUri);
    } else if (filePath.endsWith("pubspec.yaml")) {
      return getDepsInPubspecYaml(resourceUri);
    } else if (filePath.endsWith("vendor") || path.basename(path.dirname(filePath)) === "vendor") {
      return getDepsFromVendorDirectory(resourceUri);
    } else if (filePath.endsWith("composer.lock")) {
      return getDepsFromComposerLock(resourceUri);
    }

    return [];
  }

  private buildDependencyTree(filePath: string, allDependencies: Dependency[]): Dependency[] {
    const result: Dependency[] = [];

    // Get project info
    const { getPackageInfo } = require("../utils/packageInfo") as typeof import("../utils/packageInfo");
    const projectInfo = getPackageInfo(filePath);

    // Separate dependencies
    const regularDeps = allDependencies.filter((dep) => !dep.isDevDependency);
    const devDeps = allDependencies.filter((dep) => dep.isDevDependency);

    console.log(`[DependencyLoader] Building tree: ${regularDeps.length} regular, ${devDeps.length} dev deps`);

    // Add Project Info category
    if (projectInfo) {
      const infoCategory = this.createProjectInfoCategory(projectInfo);
      result.push(infoCategory);
    }

    // Add Dependencies category
    if (regularDeps.length > 0) {
      const depsCategoryItem = new Dependency(
        "Dependencies",
        "",
        vscode.TreeItemCollapsibleState.Expanded
      );
      depsCategoryItem.children = regularDeps;
      result.push(depsCategoryItem);
    }

    // Add Dev Dependencies category
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

  private createProjectInfoCategory(projectInfo: any): Dependency {
    const infoCategory = new Dependency(
      "Project Info",
      "",
      vscode.TreeItemCollapsibleState.Expanded
    );

    const iconMap: { [key: string]: string } = {
      npm: "npm",
      Composer: "package",
      pip: "symbol-namespace",
      poetry: "symbol-namespace",
      pub: "symbol-event",
      yarn: "package",
      cargo: "package",
    };

    const iconName = iconMap[projectInfo.packageManager] || "package";
    infoCategory.iconPath = new vscode.ThemeIcon(iconName);
    infoCategory.tooltip = `${projectInfo.packageManager} Project`;

    const pmVersionStr = projectInfo.packageManagerVersion
      ? ` v${projectInfo.packageManagerVersion}`
      : "";

    const basicInfoItems = [
      new Dependency(
        `Package Manager: ${projectInfo.packageManager}${pmVersionStr}`,
        "",
        vscode.TreeItemCollapsibleState.None
      ),
      new Dependency(
        `Language: ${projectInfo.language}`,
        "",
        vscode.TreeItemCollapsibleState.None
      ),
      new Dependency(
        `Runtime: ${projectInfo.runtime}`,
        "",
        vscode.TreeItemCollapsibleState.None
      ),
    ];

    const additionalInfoItems: Dependency[] = [];

    if (projectInfo.description) {
      additionalInfoItems.push(
        new Dependency(
          `Description: ${projectInfo.description}`,
          "",
          vscode.TreeItemCollapsibleState.None
        )
      );
    }

    if (projectInfo.author) {
      additionalInfoItems.push(
        new Dependency(
          `Author: ${projectInfo.author}`,
          "",
          vscode.TreeItemCollapsibleState.None
        )
      );
    }

    if (projectInfo.license) {
      additionalInfoItems.push(
        new Dependency(
          `License: ${projectInfo.license}`,
          "",
          vscode.TreeItemCollapsibleState.None
        )
      );
    }

    if (projectInfo.homepage) {
      const homepageItem = new Dependency(
        `Homepage: ${projectInfo.homepage}`,
        "",
        vscode.TreeItemCollapsibleState.None
      );
      homepageItem.command = {
        command: "vscode.open",
        title: "Open Homepage",
        arguments: [vscode.Uri.parse(projectInfo.homepage)],
      };
      additionalInfoItems.push(homepageItem);
    }

    if (projectInfo.repository) {
      const repoUrl = projectInfo.repository.startsWith("http")
        ? projectInfo.repository
        : `https://github.com/${projectInfo.repository}`;

      const repoItem = new Dependency(
        `Repository: ${projectInfo.repository}`,
        "",
        vscode.TreeItemCollapsibleState.None
      );
      repoItem.command = {
        command: "vscode.open",
        title: "Open Repository",
        arguments: [vscode.Uri.parse(repoUrl)],
      };
      additionalInfoItems.push(repoItem);
    }

    infoCategory.children = [...basicInfoItems, ...additionalInfoItems];
    return infoCategory;
  }

  private async loadVersionsInBackground(
    filePath: string,
    dependencies: Dependency[]
  ): Promise<void> {
    console.log(
      `[DependencyLoader] Starting background version loading for ${filePath} with ${dependencies.length} dependencies`
    );

    const packageDeps = dependencies.filter((dep) => !dep.children && dep.label);
    let updatedCount = 0;
    const batchSize = 10; // Increased from 5 to reduce refresh frequency

    for (let i = 0; i < packageDeps.length; i++) {
      const dep = packageDeps[i];

      try {
        let latestVersion: string | undefined;
        let deprecated = false;

        // Fetch version based on package manager
        if (dep.packageManager === "npm") {
          const { fetchLatestNpmVersion } = require("../utils/registryFetchers");
          const result = await fetchLatestNpmVersion(dep.label, dep.version);
          if (result && result.version) {
            latestVersion = result.version;
            deprecated = result.deprecated || false;
          }
        } else if (dep.packageManager === "composer") {
          const { fetchLatestPackagistVersion } = require("../utils/registryFetchers");
          latestVersion = await fetchLatestPackagistVersion(dep.label, dep.version);
        } else if (dep.packageManager === "pip" || dep.packageManager === "poetry") {
          const { fetchLatestPypiVersion } = require("../utils/registryFetchers");
          latestVersion = await fetchLatestPypiVersion(dep.label);
        } else if (dep.packageManager === "pub") {
          const { fetchLatestPubDevVersion } = require("../utils/registryFetchers");
          latestVersion = await fetchLatestPubDevVersion(dep.label);
        } else if (dep.packageManager === "cargo") {
          const { fetchLatestCargoVersion } = require("../utils/registryFetchers");
          latestVersion = await fetchLatestCargoVersion(dep.label, dep.version);
        }

        // Update the dependency with the fetched version
        if (latestVersion) {
          const { getUpdateType } = require("../utils/versionUtils");
          dep.latestVersion = latestVersion;
          dep.updateType = getUpdateType(dep.version, latestVersion);
          dep.deprecated = deprecated;
          updatedCount++;

          // Batch updates: only fire event every 10 dependencies or on last one
          // This significantly reduces tree refresh frequency
          if (updatedCount % batchSize === 0 || i === packageDeps.length - 1) {
            console.log(`[DependencyLoader] Batch update: ${updatedCount}/${packageDeps.length} dependencies updated`);
            this._onDidChangeTreeData.fire(undefined);
          }
        }
      } catch (error) {
        console.error(`[DependencyLoader] Error loading version for ${dep.label}:`, error);
      }
    }

    this._loadingQueue.delete(filePath);
    console.log(`[DependencyLoader] Completed background version loading for ${filePath}. Updated ${updatedCount}/${packageDeps.length} dependencies.`);
  }

  async getAllOutdatedDependencies(): Promise<Dependency[]> {
    const outdatedDependencies: Dependency[] = [];

    try {
      console.log("[DependencyLoader] Scanning for outdated dependencies...");

      const excludePattern = getExcludePattern();
      console.log(`[DependencyLoader] Using ${excludePattern.split(',').length} exclusion patterns`);

      // Find all manifest files in parallel
      const [packageJsonFiles, composerJsonFiles, requirementsTxtFiles, pyprojectTomlFiles, pubspecYamlFiles] = await Promise.all([
        vscode.workspace.findFiles("**/package.json", excludePattern),
        vscode.workspace.findFiles("**/composer.json", excludePattern),
        vscode.workspace.findFiles("**/requirements.txt", excludePattern),
        vscode.workspace.findFiles("**/pyproject.toml", excludePattern),
        vscode.workspace.findFiles("**/pubspec.yaml", excludePattern)
      ]);

      const totalFiles = packageJsonFiles.length + composerJsonFiles.length + 
                        requirementsTxtFiles.length + pyprojectTomlFiles.length + 
                        pubspecYamlFiles.length;
      
      console.log(`[DependencyLoader] Found ${totalFiles} manifest files to scan`);

      // Process files with additional exclusion check
      const processFiles = async (files: vscode.Uri[], parser: Function) => {
        const results: Dependency[] = [];
        for (const uri of files) {
          if (isFileExcluded(uri.fsPath)) {
            console.log(`[DependencyLoader] Skipping excluded: ${uri.fsPath}`);
            continue;
          }
          try {
            const deps = await parser(uri);
            const outdated = deps.filter(
              (dep: Dependency) => dep.updateType && dep.updateType !== "none" && dep.latestVersion
            );
            results.push(...outdated);
          } catch (error) {
            console.error(`[DependencyLoader] Error processing ${uri.fsPath}:`, error);
          }
        }
        return results;
      };

      // Process all file types in parallel for better performance
      const [npmOutdated, composerOutdated, pipOutdated, poetryOutdated, pubOutdated] = await Promise.all([
        processFiles(packageJsonFiles, getDepsInPackageJson),
        processFiles(composerJsonFiles, getDepsInComposerJson),
        processFiles(requirementsTxtFiles, getDepsInRequirementsTxt),
        processFiles(pyprojectTomlFiles, getDepsInPyprojectToml),
        processFiles(pubspecYamlFiles, getDepsInPubspecYaml)
      ]);

      outdatedDependencies.push(...npmOutdated, ...composerOutdated, ...pipOutdated, ...poetryOutdated, ...pubOutdated);
      
      console.log(`[DependencyLoader] Found ${outdatedDependencies.length} outdated dependencies`);
    } catch (error: any) {
      console.error("[DependencyLoader] Error getting outdated dependencies:", error);
      vscode.window.showErrorMessage(
        `Error scanning for outdated dependencies: ${error.message}`
      );
    }

    return outdatedDependencies;
  }
}
