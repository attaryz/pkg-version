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
import * as yaml from "js-yaml";

// Import models
import { Dependency } from "./models/dependency";

// Import utilities
import { getExcludePattern, isFileExcluded, pathExists } from "./utils/fileUtils";

// Import parsers
import { getDepsInPackageJson } from "./parsers/npmParser";
import { getDepsInComposerJson, getDepsFromComposerLock, getDepsFromVendorDirectory } from "./parsers/composerParser";
import { getDepsInRequirementsTxt } from "./parsers/pythonParser";
import { getDepsInPubspecYaml } from "./parsers/dartParser";
import { getDepsInPyprojectToml } from "./parsers/poetryParser";

// Import updaters
import { updateNpmPackage } from "./updaters/npmUpdater";
import { updateComposerPackage } from "./updaters/composerUpdater";
import { updatePypiPackage } from "./updaters/pythonUpdater";
import { updatePubDevPackage } from "./updaters/dartUpdater";
import { updatePoetryPackage, removePoetryPackage } from "./updaters/poetryUpdater";

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
      // Set formatting for category headers if not already set
      if (!element.iconPath) {
        element.iconPath = new vscode.ThemeIcon(
          "folder",
          new vscode.ThemeColor("charts.blue")
        );
      }
      
      // Add the number of dependencies to the description
      element.description = `(${element.children.length})`;
    }
    
    return element;
  }
  
  /**
   * Gets the appropriate icon for a package manager
   * 
   * @param packageManager The package manager name
   * @returns The icon ID to use for the package manager
   */
  private getPackageManagerIcon(packageManager: string): string {
    // Map package managers to VS Code's built-in file icons
    // See: https://code.visualstudio.com/api/references/icons-in-labels
    const iconMap: { [key: string]: string } = {
      'npm': 'npm',
      'Composer': 'package',
      'pip': 'symbol-namespace',  // Python-like icon
      'poetry': 'symbol-namespace',  // Python-like icon for Poetry
      'pub': 'symbol-event',      // Dart-like icon
      'yarn': 'package'
    };
    
    return iconMap[packageManager] || 'package';
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
      
      try {
        if (filePath.endsWith("package.json")) {
          allDependencies = await getDepsInPackageJson(element.resourceUri);
          console.log(`Parsed ${allDependencies.length} dependencies from package.json`);
        } else if (filePath.endsWith("composer.json")) {
          allDependencies = await getDepsInComposerJson(element.resourceUri);
        } else if (filePath.endsWith("requirements.txt")) {
          allDependencies = await getDepsInRequirementsTxt(element.resourceUri);
        } else if (filePath.endsWith("pyproject.toml")) {
          allDependencies = await getDepsInPyprojectToml(element.resourceUri);
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
      } catch (error) {
        console.error(`Error parsing dependencies from ${filePath}:`, error);
        allDependencies = [];
      }
      
      // Get project info from the manifest file
      const { getPackageInfo } = require("./utils/packageInfo") as typeof import("./utils/packageInfo");
      const projectInfo = getPackageInfo(filePath);
      
      // Log the dependencies for debugging
      console.log(`Found ${allDependencies.length} dependencies in ${filePath}`);
      
      // Separate dependencies into regular and dev dependencies
      const regularDeps = allDependencies.filter(dep => !dep.isDevDependency);
      const devDeps = allDependencies.filter(dep => dep.isDevDependency);
      
      console.log(`Regular deps: ${regularDeps.length}, Dev deps: ${devDeps.length}`);
      
      // If we have package info with dependencies but no actual dependencies were parsed,
      // create dependency objects from the package info
      if (projectInfo && 
          allDependencies.length === 0 && 
          (projectInfo.dependencies || projectInfo.devDependencies)) {
          
        console.log('Using dependencies from package.json directly');
        
        // Create dependency objects from the direct package.json data
        if (projectInfo.dependencies) {
          Object.entries(projectInfo.dependencies).forEach(([name, version]) => {
            regularDeps.push(new Dependency(
              name,
              version,
              vscode.TreeItemCollapsibleState.None,
              undefined,
              undefined,
              'none',
              'npm',
              filePath,
              false,
              undefined,
              false // not deprecated - we don't have this info when parsing directly from package.json
            ));
          });
        }
        
        if (projectInfo.devDependencies) {
          Object.entries(projectInfo.devDependencies).forEach(([name, version]) => {
            devDeps.push(new Dependency(
              name,
              version,
              vscode.TreeItemCollapsibleState.None,
              undefined,
              undefined,
              'none',
              'npm',
              filePath,
              true,
              undefined,
              false // not deprecated - we don't have this info when parsing directly from package.json
            ));
          });
        }
      }
      const result: Dependency[] = [];
      
      // Add "Project Info" category first
      if (projectInfo) {
        const infoCategory = new Dependency(
          "Project Info",
          "",
          vscode.TreeItemCollapsibleState.Expanded
        );
        
        // Add logo to the category
        const iconName = this.getPackageManagerIcon(projectInfo.packageManager);
        infoCategory.iconPath = new vscode.ThemeIcon(iconName);
        infoCategory.tooltip = `${projectInfo.packageManager} Project`;
        
        const pmVersionStr = projectInfo.packageManagerVersion ? ` v${projectInfo.packageManagerVersion}` : "";
        
        // Create the basic information items
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
          )
        ];
        
        // Add additional information items if available
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
        
        // Add homepage with clickable link if available
        if (projectInfo.homepage) {
          const homepageItem = new Dependency(
            `Homepage: ${projectInfo.homepage}`,
            "",
            vscode.TreeItemCollapsibleState.None
          );
          homepageItem.command = {
            command: "vscode.open",
            title: "Open Homepage",
            arguments: [vscode.Uri.parse(projectInfo.homepage)]
          };
          additionalInfoItems.push(homepageItem);
        }
        
        // Add repository with clickable link if available
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
            arguments: [vscode.Uri.parse(repoUrl)]
          };
          additionalInfoItems.push(repoItem);
        }
        
        // Combine all info items
        infoCategory.children = [...basicInfoItems, ...additionalInfoItems];
        
        result.push(infoCategory);
      }
      
      // Add "Dependencies" category
      if (regularDeps.length > 0) {
        const depsCategoryItem = new Dependency(
          "Dependencies",
          "",
          vscode.TreeItemCollapsibleState.Expanded
        );
        depsCategoryItem.children = regularDeps;
        
        // Log dependencies for debugging
        console.log(`Added ${regularDeps.length} regular dependencies to the tree view`);
        regularDeps.forEach(dep => {
          console.log(`- ${dep.label}: ${dep.version} → ${dep.latestVersion || 'N/A'}`);
        });
        
        result.push(depsCategoryItem);
      } else {
        console.log('No regular dependencies found to display');
      }
      
      // Add "Dev Dependencies" category
      if (devDeps.length > 0) {
        const devDepsCategoryItem = new Dependency(
          "Dev Dependencies",
          "",
          vscode.TreeItemCollapsibleState.Expanded
        );
        devDepsCategoryItem.children = devDeps;
        
        // Log dependencies for debugging
        console.log(`Added ${devDeps.length} dev dependencies to the tree view`);
        devDeps.forEach(dep => {
          console.log(`- ${dep.label}: ${dep.version} → ${dep.latestVersion || 'N/A'} [dev]`);
        });
        
        result.push(devDepsCategoryItem);
      } else {
        console.log('No dev dependencies found to display');
      }
      
      return result;
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
      patterns.push("**/pyproject.toml");
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
    // Skip if no version or latestVersion is available
    if (!dependency || !dependency.version || !dependency.latestVersion) {
      vscode.window.showErrorMessage(
        "Cannot update package: Version information missing."
      );
      return false;
    }

    // Determine which updater to use based on package manager
    if (dependency.packageManager === "npm") {
      return await updateNpmPackage(dependency);
    } else if (dependency.packageManager === "composer") {
      return await updateComposerPackage(dependency);
    } else if (dependency.packageManager === "pip") {
      return await updatePypiPackage(dependency);
    } else if (dependency.packageManager === "poetry") {
      return await updatePoetryPackage(dependency);
    } else if (dependency.packageManager === "pub") {
      return await updatePubDevPackage(dependency);
    } else {
      vscode.window.showErrorMessage(
        `Updating ${dependency.packageManager} packages is not yet supported.`
      );
      return false;
    }
  }

  /**
   * Removes a package from its parent manifest file.
   * 
   * @param dependency The dependency to remove
   * @returns Promise<boolean> Whether the removal was successful
   */
  async removePackage(dependency: Dependency): Promise<boolean> {
    // Skip if no parent file is available
    if (!dependency || !dependency.parentFile) {
      vscode.window.showErrorMessage(
        "Cannot remove package: Parent file information missing."
      );
      return false;
    }

    try {
      const parentFilePath = dependency.parentFile;
      const packageName = dependency.label;
      const isDevDependency = dependency.isDevDependency || false;
      
      // Read the parent file content
      const fileUri = vscode.Uri.file(parentFilePath);
      const fileContent = await vscode.workspace.fs.readFile(fileUri);
      const fileText = Buffer.from(fileContent).toString('utf8');
      
      let updatedContent = fileText;
      
      // Handle different package managers
      if (dependency.packageManager === "npm") {
        // Parse package.json
        const packageJson = JSON.parse(fileText);
        
        // Check if the package exists in dependencies or devDependencies
        if (isDevDependency && packageJson.devDependencies && packageJson.devDependencies[packageName]) {
          delete packageJson.devDependencies[packageName];
        } else if (!isDevDependency && packageJson.dependencies && packageJson.dependencies[packageName]) {
          delete packageJson.dependencies[packageName];
        } else {
          vscode.window.showWarningMessage(`Package ${packageName} not found in ${parentFilePath}`);
          return false;
        }
        
        // Format the updated JSON with 2-space indentation to match common style
        updatedContent = JSON.stringify(packageJson, null, 2);
      } else if (dependency.packageManager === "composer") {
        // Parse composer.json
        const composerJson = JSON.parse(fileText);
        
        // Check if the package exists in require or require-dev
        if (isDevDependency && composerJson['require-dev'] && composerJson['require-dev'][packageName]) {
          delete composerJson['require-dev'][packageName];
        } else if (!isDevDependency && composerJson.require && composerJson.require[packageName]) {
          delete composerJson.require[packageName];
        } else {
          vscode.window.showWarningMessage(`Package ${packageName} not found in ${parentFilePath}`);
          return false;
        }
        
        // Format the updated JSON with 4-space indentation (Composer standard)
        updatedContent = JSON.stringify(composerJson, null, 4);
      } else if (dependency.packageManager === "pip" && parentFilePath.endsWith("requirements.txt")) {
        // Handle requirements.txt - simple text file with one package per line
        const lines = fileText.split(/\r?\n/);
        const packagePattern = new RegExp(`^${packageName}[=~><].*$`, 'i');
        
        const updatedLines = lines.filter(line => !packagePattern.test(line.trim()));
        
        if (lines.length === updatedLines.length) {
          vscode.window.showWarningMessage(`Package ${packageName} not found in ${parentFilePath}`);
          return false;
        }
        
        updatedContent = updatedLines.join('\n');
      } else if (dependency.packageManager === "pub") {
        // For pub packages (Dart/Flutter)
        const pubspec: any = yaml.load(fileText);
        
        // Check if the package exists in dependencies or dev_dependencies
        if (isDevDependency && pubspec.dev_dependencies && pubspec.dev_dependencies[packageName]) {
          delete pubspec.dev_dependencies[packageName];
        } else if (!isDevDependency && pubspec.dependencies && pubspec.dependencies[packageName]) {
          delete pubspec.dependencies[packageName];
        } else {
          vscode.window.showWarningMessage(`Package ${packageName} not found in ${parentFilePath}`);
          return false;
        }
        
        // Convert back to YAML - maintain formatting as much as possible
        updatedContent = yaml.dump(pubspec, {
          lineWidth: -1,  // Don't wrap lines
          noRefs: true,   // Don't use YAML references
          indent: 2       // Use 2-space indentation
        });
      } else if (dependency.packageManager === "poetry") {
        // Use the Poetry-specific remove function
        return await removePoetryPackage(dependency);
      } else {
        vscode.window.showErrorMessage(
          `Removing ${dependency.packageManager} packages is not yet supported.`
        );
        return false;
      }
      
      // Write the updated content back to the file
      await vscode.workspace.fs.writeFile(
        fileUri, 
        Buffer.from(updatedContent, 'utf8')
      );
      
      // Show success message
      vscode.window.showInformationMessage(
        `Package ${packageName} has been removed from ${path.basename(parentFilePath)}`
      );
      
      // Refresh the tree view
      this.refresh();
      
      return true;
    } catch (error) {
      console.error("Error removing package:", error);
      vscode.window.showErrorMessage(`Failed to remove package: ${error}`);
      return false;
    }
  }

  /**
   * Opens a webview panel with detailed information about the package.
   * 
   * @param dependency The dependency to view
   * @returns Promise<void>
   */
  async viewPackageInfo(dependency: Dependency): Promise<void> {
    if (!dependency) {
      vscode.window.showErrorMessage("Cannot view package info: Package information missing.");
      return;
    }

    try {
      const packageName = dependency.label;
      const version = dependency.version;
      const latestVersion = dependency.latestVersion || 'Unknown';
      const packageManager = dependency.packageManager || 'Unknown';
      
      // Create and show a webview panel
      const panel = vscode.window.createWebviewPanel(
        'packageInfo', // Panel identifier
        `Package: ${packageName}`, // Panel title
        vscode.ViewColumn.One, // Show in the current active column
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [] // Allow access to all resources
        }
      );
      
      // Fetch additional information about the package based on the package manager
      let packageInfo: any = {
        description: 'No description available',
        homepage: '',
        license: 'Unknown',
        author: 'Unknown',
        repository: '',
        dependencies: {},
        downloadCount: 'Unknown',
        lastPublished: 'Unknown',
        logo: '' // Add logo URL field
      };
      
      // Attempt to get more detailed information about the package
      if (packageManager === 'npm') {
        try {
          const axios = require('axios');
          const response = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
          const data = response.data;
          
          // Get logo from npm
          let logoUrl = '';
          try {
            console.log(`Trying to fetch npm logo for ${packageName}`);
            
            // First try to get logo from package metadata if available
            if (data.versions && data.versions[version] && data.versions[version].logo) {
              logoUrl = data.versions[version].logo;
              console.log(`Found logo in package.json metadata: ${logoUrl}`);
            } 
            // Next, try to get from the GitHub repo if available
            else if (data.repository && data.repository.url && data.repository.url.includes('github.com')) {
              const repoUrl = data.repository.url
                .replace('git+https://', 'https://')
                .replace('git://', 'https://')
                .replace('.git', '')
                .replace('git@github.com:', 'https://github.com/');
              
              const repoPath = repoUrl.replace('https://github.com/', '');
              logoUrl = `https://raw.githubusercontent.com/${repoPath}/master/logo.png`;
              console.log(`Trying GitHub logo URL: ${logoUrl}`);
            }
            // Fallback to npm's avatar service
            else {
              logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
              console.log(`Using generated avatar: ${logoUrl}`);
            }
          } catch (logoError) {
            console.error('Error fetching npm logo:', logoError);
            logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
          }
          
          packageInfo = {
            description: data.description || 'No description available',
            homepage: data.homepage || '',
            license: data.license || 'Unknown',
            author: data.author ? (typeof data.author === 'string' ? data.author : data.author.name) : 'Unknown',
            repository: data.repository ? (typeof data.repository === 'string' ? data.repository : data.repository.url) : '',
            dependencies: data.versions[version]?.dependencies || {},
            downloadCount: 'Check on npm website',
            lastPublished: data.time?.modified ? new Date(data.time.modified).toLocaleDateString() : 'Unknown',
            logo: logoUrl
          };
        } catch (error) {
          console.error('Error fetching npm package info:', error);
        }
      } else if (packageManager === 'composer') {
        try {
          const axios = require('axios');
          const response = await axios.get(`https://repo.packagist.org/p2/${packageName}.json`);
          const packageData = response.data.packages[packageName][0] || {};
          
          // Get logo from packagist or the GitHub repo
          let logoUrl = '';
          try {
            console.log(`Trying to fetch composer logo for ${packageName}`);
            
            // Try to get logo from GitHub repository (if available)
            if (packageData.source && packageData.source.url && packageData.source.url.includes('github.com')) {
              const repoUrl = packageData.source.url
                .replace('git://', 'https://')
                .replace('.git', '')
                .replace('git@github.com:', 'https://github.com/');
              
              const repoPath = repoUrl.replace('https://github.com/', '');
              // Try common logo file names
              logoUrl = `https://raw.githubusercontent.com/${repoPath}/master/logo.png`;
              console.log(`Trying GitHub logo URL: ${logoUrl}`);
            } else {
              // Use generated avatar
              logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
              console.log(`Using generated avatar: ${logoUrl}`);
            }
          } catch (logoError) {
            console.error('Error fetching composer logo:', logoError);
            logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
          }
          
          packageInfo = {
            description: packageData.description || 'No description available',
            homepage: packageData.homepage || '',
            license: packageData.license?.[0] || 'Unknown',
            author: packageData.authors?.[0]?.name || 'Unknown',
            repository: packageData.source?.url || '',
            dependencies: packageData.require || {},
            downloadCount: packageData.downloads?.total?.toString() || 'Unknown',
            lastPublished: packageData.time ? new Date(packageData.time).toLocaleDateString() : 'Unknown',
            logo: logoUrl
          };
        } catch (error) {
          console.error('Error fetching Composer package info:', error);
        }
      } else if (packageManager === 'pip') {
        try {
          const axios = require('axios');
          const response = await axios.get(`https://pypi.org/pypi/${packageName}/json`);
          const data = response.data;
          
          // Get logo from PyPI
          let logoUrl = '';
          try {
            console.log(`Trying to fetch PyPI logo for ${packageName}`);
            
            // Try to get package-specific icon if available in project_urls
            if (data.info && data.info.project_urls) {
              const projectUrls = data.info.project_urls || {};
              
              if (projectUrls.Logo) {
                logoUrl = projectUrls.Logo;
                console.log(`Found logo in project_urls: ${logoUrl}`);
              } else if (data.info.project_url && data.info.project_url.includes('github.com')) {
                // Try GitHub repo if available
                const repoUrl = data.info.project_url;
                const repoPath = repoUrl.replace('https://github.com/', '');
                logoUrl = `https://raw.githubusercontent.com/${repoPath}/master/logo.png`;
                console.log(`Trying GitHub logo URL: ${logoUrl}`);
              } else {
                // Use generated avatar
                logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
                console.log(`Using generated avatar: ${logoUrl}`);
              }
            } else {
              logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
            }
          } catch (logoError) {
            console.error('Error fetching PyPI logo:', logoError);
            logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
          }
          
          packageInfo = {
            description: data.info?.summary || 'No description available',
            homepage: data.info?.home_page || '',
            license: data.info?.license || 'Unknown',
            author: data.info?.author || 'Unknown',
            repository: data.info?.project_urls?.Source || '',
            dependencies: {},
            downloadCount: 'Check on PyPI website',
            lastPublished: data.releases[version]?.[0]?.upload_time ? 
              new Date(data.releases[version][0].upload_time).toLocaleDateString() : 'Unknown',
            logo: logoUrl
          };
        } catch (error) {
          console.error('Error fetching PyPI package info:', error);
        }
      } else if (packageManager === 'pub') {
        try {
          const axios = require('axios');
          const response = await axios.get(`https://pub.dev/api/packages/${packageName}`);
          const data = response.data;
          
          // Get logo from pub.dev
          let logoUrl = '';
          try {
            console.log(`Trying to fetch pub.dev logo for ${packageName}`);
            
            // Try to get package-specific logo if available
            if (data.latest && data.latest.pubspec && data.latest.pubspec.homepage) {
              // If there's a GitHub repository, try to get the logo from there
              const homepage = data.latest.pubspec.homepage;
              if (homepage.includes('github.com')) {
                const repoPath = homepage.replace('https://github.com/', '');
                logoUrl = `https://raw.githubusercontent.com/${repoPath}/master/logo.png`;
                console.log(`Trying GitHub logo URL: ${logoUrl}`);
              } else {
                // Use generated avatar
                logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
                console.log(`Using generated avatar: ${logoUrl}`);
              }
            } else {
              logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
            }
          } catch (logoError) {
            console.error('Error fetching pub.dev logo:', logoError);
            logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
          }
          
          packageInfo = {
            description: data.latest?.pubspec?.description || 'No description available',
            homepage: data.latest?.pubspec?.homepage || '',
            license: data.latest?.pubspec?.license || 'Unknown',
            author: data.latest?.pubspec?.author || data.latest?.pubspec?.authors?.join(', ') || 'Unknown',
            repository: data.latest?.pubspec?.repository || '',
            dependencies: data.latest?.pubspec?.dependencies || {},
            downloadCount: 'Check on pub.dev website',
            lastPublished: data.latest?.published ? 
              new Date(data.latest.published).toLocaleDateString() : 'Unknown',
            logo: logoUrl
          };
        } catch (error) {
          console.error('Error fetching pub.dev package info:', error);
        }
      } else if (packageManager === 'poetry') {
        try {
          const axios = require('axios');
          const response = await axios.get(`https://pypi.org/pypi/${packageName}/json`);
          const data = response.data;
          
          // Get logo from PyPI (same as pip since Poetry uses PyPI)
          let logoUrl = '';
          try {
            console.log(`Trying to fetch PyPI logo for Poetry package ${packageName}`);
            
            // Try to get package-specific icon if available in project_urls
            if (data.info && data.info.project_urls) {
              const projectUrls = data.info.project_urls || {};
              
              if (projectUrls.Logo) {
                logoUrl = projectUrls.Logo;
                console.log(`Found logo in project_urls: ${logoUrl}`);
              } else if (data.info.project_url && data.info.project_url.includes('github.com')) {
                // Try GitHub repo if available
                const repoUrl = data.info.project_url;
                const repoPath = repoUrl.replace('https://github.com/', '');
                logoUrl = `https://raw.githubusercontent.com/${repoPath}/master/logo.png`;
                console.log(`Trying GitHub logo URL: ${logoUrl}`);
              } else {
                // Use generated avatar
                logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
                console.log(`Using generated avatar: ${logoUrl}`);
              }
            } else {
              logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
            }
          } catch (logoError) {
            console.error('Error fetching PyPI logo for Poetry package:', logoError);
            logoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(packageName)}`;
          }
          
          packageInfo = {
            description: data.info?.summary || 'No description available',
            homepage: data.info?.home_page || '',
            license: data.info?.license || 'Unknown',
            author: data.info?.author || 'Unknown',
            repository: data.info?.project_urls?.Source || '',
            dependencies: {},
            downloadCount: 'Check on PyPI website',
            lastPublished: data.releases[version]?.[0]?.upload_time ? 
              new Date(data.releases[version][0].upload_time).toLocaleDateString() : 'Unknown',
            logo: logoUrl
          };
        } catch (error) {
          console.error('Error fetching PyPI package info for Poetry package:', error);
        }
      }
      
      console.log(`Final logo URL for ${packageName}: ${packageInfo.logo}`);
      
      // Debug: Log vulnerability information
      console.log(`Vulnerabilities for ${packageName}:`, dependency.vulnerabilities);
      console.log(`Number of vulnerabilities: ${dependency.vulnerabilities?.length || 0}`);
      
      // Generate HTML content for the webview
      panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
          <title>Package Info: ${packageName}</title>
          <style>
            body {
              font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
              padding: 20px;
              color: var(--vscode-foreground);
              background-color: var(--vscode-editor-background);
            }
            .container {
              max-width: 800px;
              margin: 0 auto;
            }
            h1, h2 {
              color: var(--vscode-editor-foreground);
              border-bottom: 1px solid var(--vscode-panel-border);
              padding-bottom: 10px;
            }
            .header {
              display: flex;
              align-items: center;
              gap: 20px;
              margin-bottom: 20px;
            }
            .package-logo {
              width: 80px;
              height: 80px;
              object-fit: contain;
              border-radius: 6px;
              border: 1px solid var(--vscode-panel-border);
              padding: 8px;
              background-color: var(--vscode-input-background);
            }
            .package-logo-placeholder {
              width: 80px;
              height: 80px;
              border-radius: 6px;
              border: 1px solid var(--vscode-panel-border);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 24px;
              background-color: var(--vscode-input-background);
              color: var(--vscode-foreground);
            }
            .info-grid {
              display: grid;
              grid-template-columns: 150px 1fr;
              gap: 10px;
              margin-bottom: 20px;
            }
            .info-label {
              font-weight: bold;
              color: var(--vscode-editor-foreground);
            }
            .version-badge {
              display: inline-block;
              padding: 3px 8px;
              border-radius: 4px;
              margin-right: 5px;
              font-size: 12px;
              font-weight: bold;
            }
            .current-version {
              background-color: var(--vscode-badge-background);
              color: var(--vscode-badge-foreground);
            }
            .latest-version {
              background-color: var(--vscode-statusBarItem-prominentBackground, #388A34);
              color: var(--vscode-statusBarItem-prominentForeground, white);
            }
            a {
              color: var(--vscode-textLink-foreground);
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
            pre {
              background-color: var(--vscode-textBlockQuote-background);
              padding: 10px;
              border-radius: 4px;
              overflow: auto;
            }
            .deps-list {
              margin-top: 10px;
              max-height: 200px;
              overflow-y: auto;
              border: 1px solid var(--vscode-panel-border);
              padding: 10px;
              border-radius: 4px;
            }
            .debug-info {
              margin-top: 20px;
              padding: 10px;
              background-color: var(--vscode-textBlockQuote-background);
              border-radius: 4px;
              font-family: monospace;
              font-size: 12px;
            }
            .vulnerabilities-container {
              margin-top: 15px;
            }
            .vulnerability-card {
              border: 1px solid var(--vscode-panel-border);
              border-radius: 6px;
              padding: 15px;
              margin-bottom: 15px;
              background-color: var(--vscode-input-background);
            }
            .vulnerability-card.severity-critical,
            .vulnerability-card.severity-high {
              border-left: 4px solid var(--vscode-errorForeground);
            }
            .vulnerability-card.severity-medium {
              border-left: 4px solid var(--vscode-editorWarning-foreground);
            }
            .vulnerability-card.severity-low {
              border-left: 4px solid var(--vscode-editorInfo-foreground);
            }
            .vuln-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 10px;
            }
            .vuln-title {
              font-weight: bold;
              font-size: 14px;
            }
            .vuln-severity {
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 11px;
              font-weight: bold;
            }
            .severity-badge-critical,
            .severity-badge-high {
              background-color: var(--vscode-errorForeground);
              color: white;
            }
            .severity-badge-medium {
              background-color: var(--vscode-editorWarning-foreground);
              color: black;
            }
            .severity-badge-low {
              background-color: var(--vscode-editorInfo-foreground);
              color: white;
            }
            .vuln-details p {
              margin: 5px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${packageInfo.logo 
                ? `<img src="${packageInfo.logo}" alt="${packageName} logo" class="package-logo" 
                     onerror="this.style.display='none'; document.getElementById('logoFallback').style.display='flex';">`
                : ''}
              <div id="logoFallback" class="package-logo-placeholder" style="${packageInfo.logo ? 'display:none;' : ''}">
                ${packageName.substring(0, 2).toUpperCase()}
              </div>
              <h1>${packageName}</h1>
            </div>
            
            <div class="info-grid">
              <div class="info-label">Package Manager:</div>
              <div>${packageManager}</div>
              
              <div class="info-label">Version:</div>
              <div>
                <span class="version-badge current-version">${version}</span>
                ${version !== latestVersion ? `<span class="version-badge latest-version">Latest: ${latestVersion}</span>` : ''}
              </div>
              
              <div class="info-label">Description:</div>
              <div>${packageInfo.description}</div>
              
              <div class="info-label">License:</div>
              <div>${packageInfo.license}</div>
              
              <div class="info-label">Author:</div>
              <div>${packageInfo.author}</div>
              
              <div class="info-label">Homepage:</div>
              <div>${packageInfo.homepage ? `<a href="${packageInfo.homepage}" target="_blank">${packageInfo.homepage}</a>` : 'N/A'}</div>
              
              <div class="info-label">Repository:</div>
              <div>${packageInfo.repository ? `<a href="${packageInfo.repository}" target="_blank">${packageInfo.repository}</a>` : 'N/A'}</div>
              
              <div class="info-label">Last Published:</div>
              <div>${packageInfo.lastPublished}</div>
              <div class="info-label">Download Count:</div>
              <div>${packageInfo.downloadCount}</div>
            </div>
            
            ${dependency.vulnerabilities && dependency.vulnerabilities.length > 0 ? `
            <h2>🛡️ Security Vulnerabilities (${dependency.vulnerabilities.length})</h2>
            <div class="vulnerabilities-container">
              ${dependency.vulnerabilities.map((vuln) => {
                // Escape HTML to prevent injection and rendering issues
                const escapeHtml = (text: any): string => {
                  if (!text) return '';
                  return String(text)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
                };
                
                return `
                <div class="vulnerability-card severity-${vuln.severity}">
                  <div class="vuln-header">
                    <span class="vuln-title">${escapeHtml(vuln.title)}</span>
                    <span class="vuln-severity severity-badge-${vuln.severity}">${vuln.severity.toUpperCase()}</span>
                  </div>
                  <div class="vuln-details">
                    <p><strong>ID:</strong> ${escapeHtml(vuln.id)}</p>
                    ${vuln.cvssScore ? `<p><strong>CVSS Score:</strong> ${vuln.cvssScore}</p>` : ''}
                    ${vuln.description ? `<p><strong>Description:</strong> ${escapeHtml(vuln.description)}</p>` : ''}
                    ${vuln.fixedIn && vuln.fixedIn.length > 0 ? `<p><strong>Fixed in:</strong> ${vuln.fixedIn.map((v: string) => escapeHtml(v)).join(', ')}</p>` : '<p><strong>Fix:</strong> No fix available yet</p>'}
                    ${vuln.cve && vuln.cve.length > 0 ? `<p><strong>CVE:</strong> ${vuln.cve.map((c: string) => escapeHtml(c)).join(', ')}</p>` : ''}
                    ${vuln.cwe && vuln.cwe.length > 0 ? `<p><strong>CWE:</strong> ${vuln.cwe.map((c: string) => escapeHtml(c)).join(', ')}</p>` : ''}
                    <p><a href="${escapeHtml(vuln.url)}" target="_blank">View Details →</a></p>
                  </div>
                </div>
                `;
              }).join('')}
            </div>
            ` : `
            <!-- Debug: Vulnerability check -->
            <!-- Has vulnerabilities property: ${!!dependency.vulnerabilities} -->
            <!-- Vulnerabilities length: ${dependency.vulnerabilities?.length || 0} -->
            `}
            
            <h2>Dependencies</h2>
            <div class="deps-container">
              ${Object.keys(packageInfo.dependencies).length > 0 
                ? `<div class="deps-list">
                    <pre>${JSON.stringify(packageInfo.dependencies, null, 2)}</pre>
                  </div>`
                : '<p>No dependencies information available</p>'
              }
            </div>
          </div>
          <script>
            // Handle image loading errors
            document.addEventListener('DOMContentLoaded', () => {
              console.log('DOM loaded, setting up image error handling');
              const logoImg = document.querySelector('.package-logo');
              const logoFallback = document.getElementById('logoFallback');
              
              if (logoImg) {
                console.log('Found logo image, setting error handler');
                logoImg.onerror = () => {
                  console.log('Image failed to load, showing fallback');
                  logoImg.style.display = 'none';
                  if (logoFallback) {
                    logoFallback.style.display = 'flex';
                  }
                };
              }
            });
          </script>
        </body>
        </html>
      `;
    } catch (error) {
      console.error("Error displaying package info:", error);
      vscode.window.showErrorMessage(`Failed to display package info: ${error}`);
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

      const pyprojectTomlFiles = await vscode.workspace.findFiles(
        "**/pyproject.toml",
        excludePattern
      );

      const pubspecYamlFiles = await vscode.workspace.findFiles(
        "**/pubspec.yaml",
        excludePattern
      );

      console.log(`Found ${packageJsonFiles.length} package.json files`);
      console.log(`Found ${composerJsonFiles.length} composer.json files`);
      console.log(`Found ${requirementsTxtFiles.length} requirements.txt files`);
      console.log(`Found ${pyprojectTomlFiles.length} pyproject.toml files`);
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

      for (const pyprojectTomlUri of pyprojectTomlFiles) {
        if (isFileExcluded(pyprojectTomlUri.fsPath)) {
          continue;
        }
        const deps = await getDepsInPyprojectToml(pyprojectTomlUri);
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

  /**
   * Gets all dependencies (including all nested dependencies) from the workspace
   * @returns Promise resolving to array of all dependency items
   */
  async getAllDependencies(): Promise<Dependency[]> {
    if (!this.workspaceRoot) {
      return [];
    }
    
    const allDependencies: Dependency[] = [];
    
    // Get all package files first
    const packageFiles = await this.getChildren();
    
    // Process each package file to get its dependencies
    for (const packageFile of packageFiles) {
      // Add the package file itself
      allDependencies.push(packageFile);
      
      // Add all dependencies of this package file
      if (packageFile.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed || 
          packageFile.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
        const dependencies = await this.getChildren(packageFile);
        allDependencies.push(...dependencies);
        
        // Process potential nested dependencies (e.g., dependency categories)
        for (const dependency of dependencies) {
          if (dependency.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed || 
              dependency.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
            const nestedDependencies = await this.getChildren(dependency);
            allDependencies.push(...nestedDependencies);
          }
        }
      }
    }
    
    return allDependencies;
  }
}