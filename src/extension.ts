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
 */
async function ensureDefaultExclusions() {
  const config = vscode.workspace.getConfiguration("pkgVersion");
  const currentExclusions: string[] = config.get("excludeFolders") || [];

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
  for (const exclusion of requiredExclusions) {
    if (!currentExclusions.includes(exclusion)) {
      currentExclusions.push(exclusion);
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
  }

  // Update the configuration if needed
  if (needsUpdate) {
    await config.update(
      "excludeFolders",
      currentExclusions,
      vscode.ConfigurationTarget.Global
    );
    // Updated default exclusions
  }

  // Ensure scanVendorDirectory is set to true by default
  const scanVendorDirectory = config.get("scanVendorDirectory");
  if (scanVendorDirectory === undefined) {
    await config.update(
      "scanVendorDirectory",
      true,
      vscode.ConfigurationTarget.Global
    );
    // Set scanVendorDirectory to true by default
  }

  // Ensure composerPackageDetection is set to "auto" by default
  const composerPackageDetection = config.get("composerPackageDetection");
  if (composerPackageDetection === undefined) {
    await config.update(
      "composerPackageDetection",
      "auto",
      vscode.ConfigurationTarget.Global
    );
    // Set composerPackageDetection to 'auto' by default
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
      const excludeFolders: string[] = config.get("excludeFolders") || [];

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
        await config.update(
          "excludeFolders",
          excludeFolders,
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage(
          `Added "${folderPath}" to the excluded folders list`
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
      const excludeFolders: string[] = config.get("excludeFolders") || [];
      
      if (excludeFolders.length === 0) {
        vscode.window.showInformationMessage("No folders are currently excluded");
        return;
      }
      
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
      
      await config.update(
        "excludeFolders",
        updatedExclusions,
        vscode.ConfigurationTarget.Global
      );
      
      vscode.window.showInformationMessage(
        `Removed "${folderToRemove}" from excluded folders`
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
      const excludeFolders: string[] = config.get("excludeFolders") || [];

      // Add to exclusion list if not already there
      if (!excludeFolders.includes(pattern)) {
        excludeFolders.push(pattern);
        await config.update(
          "excludeFolders",
          excludeFolders,
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage(
          `Added "${pattern}" to the excluded patterns list`
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

  
  
  // Vulnerability commands are registered via registerVulnerabilityCommands()
  
  // Clear vulnerability cache handled in modular commands
  
  // Export vulnerability report handled via modular commands
  
  
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
  
  // Scan on save feature
  const config = vscode.workspace.getConfiguration("pkgVersion");
  if (config.get<boolean>("scanOnSave")) {
    let saveTimeout: NodeJS.Timeout | undefined;

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
        // Clear existing timeout
        if (saveTimeout) {
          clearTimeout(saveTimeout);
        }

        // Set new timeout
        const delay = config.get<number>("scanOnSaveDelay") || 2000;
        saveTimeout = setTimeout(async () => {
          await vscode.commands.executeCommand("pkg-version.checkVulnerabilities");
        }, delay);
      }
    });

    context.subscriptions.push(watcher);
  }
  
  // Initial update of dependency counter in the status bar
  updateDependencyStatusCounterUtil(dependencyProvider);
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
