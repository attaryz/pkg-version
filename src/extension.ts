// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { DependencyProvider } from "./dependencyProvider"; // Import the provider
import * as path from "path";
import { refreshVulnerabilityProviderManager } from "./utils/vulnerabilityProviderManager";
import { registerVulnerabilityCommands } from "./commands/vulnerabilityCommands";
import { initializeStatusBar, updateDependencyStatusCounter as updateDependencyStatusCounterUtil } from "./utils/statusBar";
import { Dependency } from "./models/dependency"; // Import Dependency model
import { FileInfoProvider } from "./utils/fileInfoProvider"; // Import the FileInfoProvider
import { generateRequirementsTxt } from "./parsers/poetryParser"; // Import Poetry requirements generator
import { SecurityReportProvider } from "./securityReportProvider";



/**
 * Ensures that default exclusion settings are properly applied to prevent
 * scanning of large folders like node_modules, which could impact performance.
 * This adds critical exclusions if they're not already configured.
 * IMPORTANT: This preserves user-added exclusions.
 */
async function ensureDefaultExclusions() {
  const config = vscode.workspace.getConfiguration("pkgVersion");
  
  // Use inspect to get the actual global value (user settings)
  const inspection = config.inspect<string[]>("excludeFolders");
  const globalValue = inspection?.globalValue;
  const defaultValue = inspection?.defaultValue || [];
  
  // If user has never set this, globalValue will be undefined
  // In that case, we use the default value
  const currentExclusions: string[] = globalValue ? [...globalValue] : [...defaultValue];
  
  console.log(`Current exclusions count: ${currentExclusions.length}`);
  console.log(`Has global value: ${!!globalValue}`);

  // Basic default exclusions that should always be present
  const requiredExclusions = [
    "**/node_modules/**",
    "**/vendor/**/vendor/**", // Only exclude nested vendor folders
    "**/venv/**",
    "**/.git/**",
    // Add lock files and similar files
    "**/*.lock", // Excludes package-lock.json, composer.lock, yarn.lock, etc.
    "**/yarn-error.log",
    "**/package-lock.json",
    "**/npm-debug.log",
    "**/composer.lock",
    "**/Gemfile.lock",
    "**/Cargo.lock",
    "**/*.bak",
    "**/*.backup"
  ];

  // Check if any required exclusions are missing
  let needsUpdate = false;
  const addedExclusions: string[] = [];
  
  for (const exclusion of requiredExclusions) {
    if (!currentExclusions.includes(exclusion)) {
      currentExclusions.push(exclusion);
      addedExclusions.push(exclusion);
      needsUpdate = true;
    }
  }

  // Check if we need to update the old vendor exclusion to the new pattern
  const oldVendorExclusion = "**/vendor/**";
  const indexOfOldVendor = currentExclusions.indexOf(oldVendorExclusion);
  if (indexOfOldVendor !== -1) {
    // Replace old vendor exclusion with new nested vendor exclusion
    currentExclusions[indexOfOldVendor] = "**/vendor/**/vendor/**";
    needsUpdate = true;
    console.log("Updated old vendor exclusion pattern");
  }

  // Update the configuration if needed
  if (needsUpdate) {
    console.log(`Adding ${addedExclusions.length} missing default exclusions`);
    await config.update(
      "excludeFolders",
      currentExclusions,
      vscode.ConfigurationTarget.Global
    );
    console.log(`Updated exclusions. New count: ${currentExclusions.length}`);
  } else {
    console.log("No default exclusions needed to be added");
  }

  // Ensure scanVendorDirectory is set to true by default
  const scanVendorDirectory = config.get("scanVendorDirectory");
  if (scanVendorDirectory === undefined) {
    await config.update(
      "scanVendorDirectory",
      true,
      vscode.ConfigurationTarget.Global
    );
    console.log("Set scanVendorDirectory to true by default");
  }

  // Ensure composerPackageDetection is set to "auto" by default
  const composerPackageDetection = config.get("composerPackageDetection");
  if (composerPackageDetection === undefined) {
    await config.update(
      "composerPackageDetection",
      "auto",
      vscode.ConfigurationTarget.Global
    );
    console.log("Set composerPackageDetection to 'auto' by default");
  }
}

/**
 * Activates the extension and registers all commands and providers.
 * Sets up the dependency tree view and related functionality.
 *
 * @param {vscode.ExtensionContext} context - The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
  // Extension activated

  // Initialize unified status bar via utility
  initializeStatusBar(context);

  // Ensure default exclusions are set
  ensureDefaultExclusions();

  // Declare disposable variable at the top
  let disposable: vscode.Disposable;

  // Get workspace root path for the provider
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  // Register the TreeView provider
  const dependencyProvider = new DependencyProvider(rootPath);

  // Set up dependency status counter update
  dependencyProvider.onDidChangeTreeData(() => {
    updateDependencyStatusCounterUtil(dependencyProvider);
  });
  
  // Create tree view to get selection
  const packageTreeView = vscode.window.createTreeView("packageDependencies", {
    treeDataProvider: dependencyProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(packageTreeView);

  // Register the Security Report provider and view
  const securityReportProvider = new SecurityReportProvider(dependencyProvider);
  const securityReportView = vscode.window.createTreeView('securityReportView', {
    treeDataProvider: securityReportProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(securityReportView);

  // Register refresh command for the security report view
  disposable = vscode.commands.registerCommand(
    "pkg-version.refreshSecurityReport",
    () => {
      // Refresh security report
      securityReportProvider.refresh();
      vscode.window.showInformationMessage("Security report refreshed!");
    }
  );
  context.subscriptions.push(disposable);

  // Register modular vulnerability commands
  registerVulnerabilityCommands(
    context,
    dependencyProvider,
    packageTreeView,
    updateDependencyStatusCounterUtil
  );

  // Register the FileInfoProvider
  const fileInfoProvider = new FileInfoProvider();
  
  // Register the tree data provider for the file info view
  const fileInfoTreeView = vscode.window.createTreeView('fileInfoView', {
    treeDataProvider: fileInfoProvider,
    showCollapseAll: false
  });
  
  context.subscriptions.push(fileInfoTreeView);
  
  // Register refresh command for the file info view
  disposable = vscode.commands.registerCommand(
    "pkg-version.refreshFileInfo",
    () => {
      // Refresh file info
      fileInfoProvider.refresh();
      vscode.window.showInformationMessage("File info refreshed!");
    }
  );
  context.subscriptions.push(disposable);

  // Register refresh command for the dependency tree view
  disposable = vscode.commands.registerCommand(
    "pkg-version.refreshDependencies",
    () => {
      // Refresh dependencies
      dependencyProvider.refresh();
      vscode.window.showInformationMessage("Dependencies refreshed!");
      // Status counter will be updated via the onDidChangeTreeData event
      securityReportProvider.refresh();
    }
  );
  context.subscriptions.push(disposable);
  
  // Register remove package command
  disposable = vscode.commands.registerCommand(
    "pkg-version.removePackage",
    async (dependency: Dependency) => {
      if (!dependency) {
        vscode.window.showErrorMessage(
          "Please select a package to remove from the dependencies view"
        );
        return;
      }
      
      // Confirm before removing
      const confirmResult = await vscode.window.showWarningMessage(
        `Are you sure you want to remove ${dependency.label}?`,
        { modal: true },
        "Yes",
        "No"
      );
      
      if (confirmResult !== "Yes") {
        return;
      }
      
      try {
        // Call the remove package method which we'll implement
        await dependencyProvider.removePackage(dependency);
        dependencyProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to remove package: ${error}`);
      }
    }
  );
  context.subscriptions.push(disposable);

  // Register command to check for updates manually
  disposable = vscode.commands.registerCommand(
    "pkg-version.checkUpdates",
    async () => {
      try {
        dependencyProvider.refresh();
        securityReportProvider.refresh();
        await updateDependencyStatusCounterUtil(dependencyProvider);
        vscode.window.showInformationMessage("Dependencies updated!");
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to check for updates: ${error}`);
      }
    }
  );
  context.subscriptions.push(disposable);

  // Register view package info command
  disposable = vscode.commands.registerCommand(
    "pkg-version.viewPackageInfo",
    async (dependency: Dependency) => {
      if (!dependency) {
        vscode.window.showErrorMessage(
          "Please select a package to view from the dependencies view"
        );
        return;
      }
      
      try {
        // Call the view package info method which we'll implement
        await dependencyProvider.viewPackageInfo(dependency);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to view package info: ${error}`);
      }
    }
  );
  context.subscriptions.push(disposable);

  // Register update single package command
  disposable = vscode.commands.registerCommand(
    "pkg-version.updatePackage",
    async (dependency: Dependency) => {
      if (!dependency) {
        vscode.window.showErrorMessage(
          "Please select a package to update from the dependencies view"
        );
        return;
      }

      const success = await dependencyProvider.updatePackage(dependency);

      if (success) {
        vscode.window.showInformationMessage(
          `${dependency.label} updated to ${dependency.latestVersion}`
        );
        dependencyProvider.refresh();
      }
    }
  );
  context.subscriptions.push(disposable);

  // Register update all packages command
  disposable = vscode.commands.registerCommand(
    "pkg-version.updateAllPackages",
    async () => {
      // Show a confirmation dialog to ensure the user wants to update all packages
      const choice = await vscode.window.showQuickPick(
        ["Yes, update all packages", "No, cancel"],
        {
          placeHolder:
            "This will update all outdated packages. Are you sure you want to continue?",
          canPickMany: false,
        }
      );

      if (choice !== "Yes, update all packages") {
        return;
      }

      // Get all outdated dependencies from the provider
      const allDependencies =
        await dependencyProvider.getAllOutdatedDependencies();

      if (allDependencies.length === 0) {
        vscode.window.showInformationMessage("No outdated packages found.");
        return;
      }

      // Show progress indicator
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Updating packages",
          cancellable: true,
        },
        async (progress, token) => {
          let successCount = 0;
          let failCount = 0;

          // Calculate increment step for progress bar
          const incrementStep = 100 / allDependencies.length;

          for (let i = 0; i < allDependencies.length; i++) {
            if (token.isCancellationRequested) {
              vscode.window.showInformationMessage(
                "Package update operation cancelled."
              );
              break;
            }

            const dependency = allDependencies[i];
            progress.report({
              message: `Updating ${dependency.label} (${i + 1}/${
                allDependencies.length
              })`,
              increment: incrementStep,
            });

            const success = await dependencyProvider.updatePackage(dependency);
            if (success) {
              successCount++;
            } else {
              failCount++;
            }
          }

          if (successCount > 0 || failCount > 0) {
            vscode.window.showInformationMessage(
              `Update complete. ${successCount} package(s) updated successfully. ${failCount} package(s) failed.`
            );
          }

          // Refresh the view to show updated status
          dependencyProvider.refresh();
        }
      );
    }
  );
  context.subscriptions.push(disposable);

  /**
   * Command to exclude a folder from dependency scanning.
   * Users can exclude folders that contain many package files but aren't relevant
   * to their project, improving performance and reducing noise.
   */
  disposable = vscode.commands.registerCommand(
    "pkg-version.excludeFolder",
    async () => {
      // Ask for a folder to exclude
      const folders = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: "Select Folder to Exclude",
      });

      if (!folders || folders.length === 0) {
        return;
      }

      const folder = folders[0];
      const config = vscode.workspace.getConfiguration("pkgVersion");
      
      // Get current exclusions from the actual configuration
      // Use inspect to get the global value specifically
      const inspection = config.inspect<string[]>("excludeFolders");
      const excludeFolders: string[] = [...(inspection?.globalValue || inspection?.defaultValue || [])];

      // Get the folder path relative to the workspace if possible
      let folderPath = folder.fsPath;
      if (vscode.workspace.workspaceFolders) {
        for (const workspace of vscode.workspace.workspaceFolders) {
          if (folderPath.startsWith(workspace.uri.fsPath)) {
            folderPath = folderPath.substring(workspace.uri.fsPath.length);
            break;
          }
        }
      }

      // Convert to glob pattern for matching
      folderPath = folderPath.replace(/\\/g, "/"); // Normalize slashes
      if (folderPath.startsWith("/")) {
        folderPath = folderPath.substring(1); // Remove leading slash
      }
      const globPattern = `**/${folderPath}/**`;

      // Add to exclusion list if not already there
      if (!excludeFolders.includes(globPattern)) {
        excludeFolders.push(globPattern);
        
        // Save to global settings
        await config.update(
          "excludeFolders",
          excludeFolders,
          vscode.ConfigurationTarget.Global
        );
        
        console.log(`Added exclusion pattern: ${globPattern}`);
        console.log(`Total exclusions: ${excludeFolders.length}`);
        
        vscode.window.showInformationMessage(
          `Added "${folderPath}" to the excluded folders list (saved to User Settings)`
        );
        
        // Refresh the tree view to apply the new exclusion
        dependencyProvider.refresh();
      } else {
        vscode.window.showInformationMessage(
          `"${folderPath}" is already in the excluded folders list`
        );
      }
    }
  );
  context.subscriptions.push(disposable);
  
  /**
   * Command to show excluded folders and allow removing them.
   * This makes it easier for users to manage their exclusion list.
   */
  disposable = vscode.commands.registerCommand(
    "pkg-version.manageExclusions",
    async () => {
      const config = vscode.workspace.getConfiguration("pkgVersion");
      
      // Use inspect to get the actual global value
      const inspection = config.inspect<string[]>("excludeFolders");
      const excludeFolders: string[] = [...(inspection?.globalValue || inspection?.defaultValue || [])];
      
      if (excludeFolders.length === 0) {
        vscode.window.showInformationMessage("No folders are currently excluded");
        return;
      }
      
      console.log(`Managing ${excludeFolders.length} exclusions`);
      
      // Show the excluded folders with options to remove
      const selectedFolder = await vscode.window.showQuickPick(
        [
          { label: "Keep all exclusions", description: "Don't remove any folders" },
          ...excludeFolders.map(folder => ({ 
            label: `Remove: ${folder}`, 
            folder 
          }))
        ],
        {
          placeHolder: "Select an exclusion to remove or 'Keep all exclusions'",
        }
      );
      
      if (!selectedFolder || selectedFolder.label === "Keep all exclusions") {
        return;
      }
      
      // Remove the selected folder from the exclusion list
      const folderToRemove = (selectedFolder as any).folder;
      const updatedExclusions = excludeFolders.filter(f => f !== folderToRemove);
      
      console.log(`Removing exclusion: ${folderToRemove}`);
      console.log(`Remaining exclusions: ${updatedExclusions.length}`);
      
      await config.update(
        "excludeFolders",
        updatedExclusions,
        vscode.ConfigurationTarget.Global
      );
      
      vscode.window.showInformationMessage(
        `Removed "${folderToRemove}" from excluded folders (saved to User Settings)`
      );
      
      // Refresh the tree view to apply the updated exclusions
      dependencyProvider.refresh();
    }
  );
  context.subscriptions.push(disposable);
  
  /**
   * Command to exclude specific files or deeper folder structures using custom glob patterns.
   * This provides more granular control than the folder exclusion command.
   */
  disposable = vscode.commands.registerCommand(
    "pkg-version.excludeCustomPattern",
    async () => {
      // Prompt user for custom glob pattern
      const pattern = await vscode.window.showInputBox({
        prompt: "Enter a glob pattern for exclusion",
        placeHolder: "e.g., **/specific/path/to/exclude/** or **/*.specific.json",
        value: "**/",
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "Pattern cannot be empty";
          }
          return null;
        }
      });

      if (!pattern) {
        return; // User cancelled
      }

      const config = vscode.workspace.getConfiguration("pkgVersion");
      
      // Use inspect to get the actual global value
      const inspection = config.inspect<string[]>("excludeFolders");
      const excludeFolders: string[] = [...(inspection?.globalValue || inspection?.defaultValue || [])];

      // Add to exclusion list if not already there
      if (!excludeFolders.includes(pattern)) {
        excludeFolders.push(pattern);
        
        console.log(`Adding custom exclusion pattern: ${pattern}`);
        console.log(`Total exclusions: ${excludeFolders.length}`);
        
        await config.update(
          "excludeFolders",
          excludeFolders,
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage(
          `Added "${pattern}" to the excluded patterns list (saved to User Settings)`
        );
        
        // Refresh the tree view to apply the new exclusion
        dependencyProvider.refresh();
      } else {
        vscode.window.showInformationMessage(
          `"${pattern}" is already in the excluded patterns list`
        );
      }
    }
  );
  context.subscriptions.push(disposable);

  /**
   * Command to remove a file/folder from the exclude list
   * This is shown in the context menu of excluded manifest files
   */
  disposable = vscode.commands.registerCommand(
    "pkg-version.removeFromExcludeList",
    async (dependency: Dependency) => {
      if (!dependency || !dependency.resourceUri) {
        vscode.window.showErrorMessage("Please select an excluded item to restore");
        return;
      }

      const filePath = dependency.resourceUri.fsPath;
      const relativePath = vscode.workspace.asRelativePath(dependency.resourceUri);
      
      const config = vscode.workspace.getConfiguration("pkgVersion");
      const inspection = config.inspect<string[]>("excludeFolders");
      const excludeFolders: string[] = [...(inspection?.globalValue || inspection?.defaultValue || [])];

      // Find which pattern matches this file
      const { matchesGlobPattern } = require("./utils/fileUtils");
      const normalizedPath = filePath.replace(/\\/g, "/");
      const matchingPatterns: string[] = [];
      
      for (const pattern of excludeFolders) {
        if (matchesGlobPattern(normalizedPath, pattern)) {
          matchingPatterns.push(pattern);
        }
      }

      if (matchingPatterns.length === 0) {
        vscode.window.showWarningMessage(`No exclusion pattern found for ${relativePath}`);
        return;
      }

      // If multiple patterns match, let user choose which to remove
      let patternToRemove: string;
      if (matchingPatterns.length === 1) {
        patternToRemove = matchingPatterns[0];
      } else {
        const selected = await vscode.window.showQuickPick(
          matchingPatterns.map(p => ({ label: p, pattern: p })),
          {
            placeHolder: "Multiple patterns match this file. Select which one to remove:",
          }
        );
        if (!selected) {
          return;
        }
        patternToRemove = selected.pattern;
      }

      // Confirm removal
      const confirmResult = await vscode.window.showWarningMessage(
        `Remove exclusion pattern "${patternToRemove}"?\n\nThis will allow "${relativePath}" to be scanned for packages.`,
        { modal: true },
        "Yes",
        "No"
      );

      if (confirmResult !== "Yes") {
        return;
      }

      // Remove the pattern
      const updatedExclusions = excludeFolders.filter(p => p !== patternToRemove);

      console.log(`Removing exclusion pattern: ${patternToRemove}`);
      console.log(`Remaining exclusions: ${updatedExclusions.length}`);

      await config.update(
        "excludeFolders",
        updatedExclusions,
        vscode.ConfigurationTarget.Global
      );

      vscode.window.showInformationMessage(
        `Removed exclusion pattern "${patternToRemove}". File will now be scanned.`
      );

      // Refresh the tree view
      dependencyProvider.refresh();
    }
  );
  context.subscriptions.push(disposable);
  
  
  // Vulnerability commands are registered via registerVulnerabilityCommands()
  
  // Clear vulnerability cache handled in modular commands
  
  // Export vulnerability report handled via modular commands
  
  
  // Register command to add a package to the exclude list
  disposable = vscode.commands.registerCommand(
    "pkg-version.addPackageToExcludeList",
    async (dependency: Dependency) => {
      if (!dependency || !dependency.label) {
        vscode.window.showErrorMessage("Please select a package to exclude");
        return;
      }

      const packageName = dependency.label;
      
      // Confirm before adding to exclude list
      const confirmResult = await vscode.window.showWarningMessage(
        `Add "${packageName}" to the exclude list? This package will be hidden from the dependency tree.`,
        { modal: true },
        "Yes",
        "No"
      );
      
      if (confirmResult !== "Yes") {
        return;
      }

      try {
        const config = vscode.workspace.getConfiguration("pkgVersion");
        const excludeFolders: string[] = config.get("excludeFolders") || [];
        
        // Create a pattern to exclude this specific package name
        const excludePattern = `**/${packageName}`;
        
        if (!excludeFolders.includes(excludePattern)) {
          excludeFolders.push(excludePattern);
          await config.update(
            "excludeFolders",
            excludeFolders,
            vscode.ConfigurationTarget.Global
          );
          vscode.window.showInformationMessage(
            `Added "${packageName}" to the exclude list`
          );
          
          // Refresh the tree view
          dependencyProvider.refresh();
        } else {
          vscode.window.showInformationMessage(
            `"${packageName}" is already in the exclude list`
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to add package to exclude list: ${error}`);
      }
    }
  );
  context.subscriptions.push(disposable);

  // Register command to refresh dependencies for a specific manifest file
  disposable = vscode.commands.registerCommand(
    "pkg-version.refreshManifestFile",
    async (manifestDependency: Dependency) => {
      if (!manifestDependency || !manifestDependency.resourceUri) {
        vscode.window.showErrorMessage("Please select a manifest file to refresh");
        return;
      }

      try {
        const fileName = path.basename(manifestDependency.resourceUri.fsPath);
        vscode.window.showInformationMessage(`Refreshing dependencies for ${fileName}...`);
        
        // Refresh the entire tree (VS Code will re-fetch children for this node)
        dependencyProvider.refresh();
        
        vscode.window.showInformationMessage(`Dependencies for ${fileName} refreshed!`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh manifest file: ${error}`);
      }
    }
  );
  context.subscriptions.push(disposable);

  // Register command to scan a specific manifest file for vulnerabilities
  disposable = vscode.commands.registerCommand(
    "pkg-version.scanManifestVulnerabilities",
    async (manifestDependency: Dependency) => {
      if (!manifestDependency || !manifestDependency.resourceUri) {
        vscode.window.showErrorMessage("Please select a manifest file to scan");
        return;
      }

      try {
        const fileName = path.basename(manifestDependency.resourceUri.fsPath);
        const filePath = manifestDependency.resourceUri.fsPath;
        
        // Get all dependencies from this manifest file
        let allDependencies: Dependency[] = [];
        
        if (filePath.endsWith("package.json")) {
          const { getDepsInPackageJson } = require("./parsers/npmParser");
          allDependencies = await getDepsInPackageJson(manifestDependency.resourceUri);
        } else if (filePath.endsWith("composer.json")) {
          const { getDepsInComposerJson } = require("./parsers/composerParser");
          allDependencies = await getDepsInComposerJson(manifestDependency.resourceUri);
        } else if (filePath.endsWith("requirements.txt")) {
          const { getDepsInRequirementsTxt } = require("./parsers/pythonParser");
          allDependencies = await getDepsInRequirementsTxt(manifestDependency.resourceUri);
        } else if (filePath.endsWith("pyproject.toml")) {
          const { getDepsInPyprojectToml } = require("./parsers/poetryParser");
          allDependencies = await getDepsInPyprojectToml(manifestDependency.resourceUri);
        } else if (filePath.endsWith("Cargo.toml")) {
          const { getDepsInCargoToml } = require("./parsers/cargoParser");
          allDependencies = await getDepsInCargoToml(manifestDependency.resourceUri);
        } else if (filePath.endsWith("pubspec.yaml")) {
          const { getDepsInPubspecYaml } = require("./parsers/dartParser");
          allDependencies = await getDepsInPubspecYaml(manifestDependency.resourceUri);
        } else {
          vscode.window.showErrorMessage(`Unsupported manifest file type: ${fileName}`);
          return;
        }

        const packageDependencies = allDependencies.filter(
          (dep: Dependency) => dep.label && dep.packageManager && !dep.children
        );

        if (packageDependencies.length === 0) {
          vscode.window.showInformationMessage(
            `No dependencies found in ${fileName}`
          );
          return;
        }

        const { getVulnerabilityProviderManager } = require("./utils/vulnerabilityProviderManager");
        const providerManager = getVulnerabilityProviderManager();
        
        const hasProvider = await providerManager.hasReadyProvider();
        
        if (!hasProvider) {
          const configureSettings = "Configure Settings";
          const response = await vscode.window.showWarningMessage(
            "No vulnerability providers are configured. OSV.dev works without configuration, or you can configure Snyk.",
            configureSettings
          );
          
          if (response === configureSettings) {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "pkgVersion.vulnerability"
            );
          }
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Scanning ${fileName} for vulnerabilities`,
            cancellable: true,
          },
          async (progress, token) => {
            let vulnerablePackages = 0;
            let checkedPackages = 0;
            let totalVulnerabilities = 0;
            
            const incrementStep = 100 / packageDependencies.length;
            
            for (let i = 0; i < packageDependencies.length; i++) {
              if (token.isCancellationRequested) {
                vscode.window.showInformationMessage(
                  "Vulnerability check cancelled."
                );
                break;
              }
              
              const dependency = packageDependencies[i];
              progress.report({
                message: `Checking ${dependency.label} (${i + 1}/${
                  packageDependencies.length
                })`,
                increment: incrementStep,
              });
              
              if (!dependency.label || !dependency.packageManager) {
                continue;
              }
              
              const { resolveInstalledVersion, cleanVersionSpecifier } = require("./utils/installedVersion");
              const effectiveVersion =
                (await resolveInstalledVersion(dependency)) ||
                cleanVersionSpecifier(dependency.version) ||
                "";

              const vulnerabilities = await providerManager.checkPackageVulnerabilities(
                dependency.label,
                effectiveVersion,
                dependency.packageManager || ""
              );
              
              if (vulnerabilities) {
                if ('success' in vulnerabilities && vulnerabilities.success === false) {
                  // Error checking package
                } else if (Array.isArray(vulnerabilities)) {
                  dependency.vulnerabilities = vulnerabilities;
                  checkedPackages++;
                  
                  if (vulnerabilities.length > 0) {
                    vulnerablePackages++;
                    totalVulnerabilities += vulnerabilities.length;
                  }
                }
              }
            }
            
            if (vulnerablePackages > 0) {
              const viewDetails = "View Details";
              const response = await vscode.window.showWarningMessage(
                `Found ${totalVulnerabilities} vulnerabilities in ${vulnerablePackages} packages in ${fileName}.`,
                viewDetails
              );
              
              if (response === viewDetails) {
                dependencyProvider.refresh();
              }
            } else {
              vscode.window.showInformationMessage(
                `No vulnerabilities found in ${checkedPackages} packages from ${fileName}.`
              );
            }
            
            dependencyProvider.refresh();
            updateDependencyStatusCounterUtil(dependencyProvider);
            
            try {
              await vscode.commands.executeCommand("pkg-version.refreshSecurityReport");
            } catch {
              // Failed to refresh Security Report view
            }
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to scan manifest file: ${error}`);
      }
    }
  );
  context.subscriptions.push(disposable);

  // Register generate requirements.txt from pyproject.toml command
  disposable = vscode.commands.registerCommand(
    "pkg-version.generateRequirementsTxt",
    async () => {
      try {
        // Find pyproject.toml files in the workspace
        const pyprojectFiles = await vscode.workspace.findFiles(
          "**/pyproject.toml",
          "**/node_modules/**"
        );

        if (pyprojectFiles.length === 0) {
          vscode.window.showErrorMessage(
            "No pyproject.toml file found in the workspace"
          );
          return;
        }

        let targetFile: vscode.Uri;

        if (pyprojectFiles.length > 1) {
          // If multiple pyproject.toml files, let user choose which one to use
          const items = pyprojectFiles.map((file) => ({
            label: vscode.workspace.asRelativePath(file),
            file,
          }));

          const selection = await vscode.window.showQuickPick(items, {
            placeHolder: "Select pyproject.toml file to generate requirements.txt from",
          });

          if (!selection) {
            return;
          }

          targetFile = selection.file;
        } else {
          // Only one pyproject.toml, use it
          targetFile = pyprojectFiles[0];
        }

        // Generate requirements.txt content
        const requirementsContent = await generateRequirementsTxt(targetFile);

        // Ask user where to save the requirements.txt file
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.joinPath(
            vscode.Uri.file(path.dirname(targetFile.fsPath)),
            "requirements.txt"
          ),
          filters: {
            "Text files": ["txt"],
            "All files": ["*"],
          },
        });

        if (!saveUri) {
          return;
        }

        // Write the requirements.txt file
        await vscode.workspace.fs.writeFile(
          saveUri,
          Buffer.from(requirementsContent, "utf8")
        );

        vscode.window.showInformationMessage(
          `Generated requirements.txt from ${vscode.workspace.asRelativePath(
            targetFile
          )} and saved to ${vscode.workspace.asRelativePath(saveUri)}`
        );

        // Open the generated file
        const document = await vscode.workspace.openTextDocument(saveUri);
        await vscode.window.showTextDocument(document);
      } catch (err: any) {
        console.error("Error generating requirements.txt:", err);
        vscode.window.showErrorMessage(
          `Failed to generate requirements.txt: ${err.message}`
        );
      }
    }
  );
  context.subscriptions.push(disposable);
  
  // Listen for configuration changes to refresh vulnerability providers
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("pkgVersion.useOSVProvider") ||
          e.affectsConfiguration("pkgVersion.useGitHubAdvisoryProvider") ||
          e.affectsConfiguration("pkgVersion.useSnykProvider") ||
          e.affectsConfiguration("pkgVersion.snykApiToken") ||
          e.affectsConfiguration("pkgVersion.snykOrgId")) {
        refreshVulnerabilityProviderManager();
      }
    })
  );
  
  // Scan on save feature - with improved debouncing and exclusion checking
  const config = vscode.workspace.getConfiguration("pkgVersion");
  if (config.get<boolean>("scanOnSave")) {
    let saveTimeout: NodeJS.Timeout | undefined;
    let lastScanTime = 0;
    const minScanInterval = 5000; // Minimum 5 seconds between scans

    const watcher = vscode.workspace.onDidSaveTextDocument((document) => {
      // Check if it's a package file
      const fileName = path.basename(document.fileName);
      const packageFiles = [
        "package.json",
        "composer.json",
        "pyproject.toml",
        "requirements.txt",
        "Cargo.toml",
        "pom.xml",
        "build.gradle",
        "pubspec.yaml",
      ];

      if (packageFiles.includes(fileName)) {
        // Check if file is excluded
        const { isFileExcluded } = require("./utils/fileUtils");
        if (isFileExcluded(document.fileName)) {
          console.log(`[SaveWatcher] Skipping excluded file: ${document.fileName}`);
          return;
        }

        // Rate limiting: prevent scans more frequent than minScanInterval
        const now = Date.now();
        if (now - lastScanTime < minScanInterval) {
          console.log(`[SaveWatcher] Skipping scan - too soon after last scan (${now - lastScanTime}ms)`);
          return;
        }

        // Clear existing timeout
        if (saveTimeout) {
          clearTimeout(saveTimeout);
        }

        // Set new timeout
        const delay = config.get<number>("scanOnSaveDelay") || 2000;
        saveTimeout = setTimeout(async () => {
          console.log(`[SaveWatcher] Triggering scan for ${fileName}`);
          lastScanTime = Date.now();
          
          // Only refresh dependencies, don't trigger full vulnerability scan
          // User can manually trigger vulnerability scan if needed
          dependencyProvider.refresh();
        }, delay);
      }
    });

    context.subscriptions.push(watcher);
  }
  
  // Status bar will update automatically as dependencies are loaded
  // via the onDidChangeTreeData event listener set up earlier
}



/**
 * Called when the extension is deactivated.
 * Use this to clean up any resources the extension has allocated.
 */
export function deactivate() {
  // Nothing to clean up at this time
  // Extension deactivated
}

/**
 * Updates the unified status bar item displaying dependency statistics.
 * Shows a single status bar item with format "Package updates: X major, Y minor, Z patch, W deprecated".
 * 
 * @param provider The dependency provider to get dependency information from
 */
// Using updateDependencyStatusCounterUtil from utils/statusBar
