// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { DependencyProvider } from "./dependencyProvider"; // Import the provider
import * as path from "path";
import { getSnykClient } from "./utils/snykClient";
import { Dependency } from "./models/dependency"; // Import Dependency model

// Status bar item to display dependency statistics
let dependencyStatusBarItem: vscode.StatusBarItem;

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
    console.log(
      "Updated default exclusions to ensure nested vendor folders, lock files, and other critical files are excluded"
    );
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
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "pkg-version" is now active!');

  // Create status bar item
  dependencyStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  dependencyStatusBarItem.command = "pkg-version.refreshDependencies";
  dependencyStatusBarItem.tooltip = "Package Version Status - Click to refresh";
  context.subscriptions.push(dependencyStatusBarItem);

  // Ensure default exclusions are set
  ensureDefaultExclusions().then(() => {
    console.log("Default exclusions verified");
  });

  // Declare disposable variable at the top
  let disposable: vscode.Disposable;

  // Register the checkUpdates command defined in package.json
  disposable = vscode.commands.registerCommand(
    "pkg-version.checkUpdates",
    function () {
      vscode.window.showInformationMessage("Checking for package updates!");
      // TODO: Implement full package update check functionality
      // This should scan all package files and report outdated dependencies
    }
  );

  context.subscriptions.push(disposable);

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
    updateDependencyStatusCounter(dependencyProvider);
  });
  
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "packageDependencies", // This must match the view id in package.json
      dependencyProvider
    )
  );

  // Register refresh command for the dependency tree view
  disposable = vscode.commands.registerCommand(
    "pkg-version.refreshDependencies",
    () => {
      console.log("Refresh dependencies command executed");
      dependencyProvider.refresh();
      vscode.window.showInformationMessage("Dependencies refreshed!");
      // Status counter will be updated via the onDidChangeTreeData event
    }
  );
  context.subscriptions.push(disposable);

  // Register update package command
  disposable = vscode.commands.registerCommand(
    "pkg-version.updatePackage",
    async (dependency) => {
      // If dependency is not provided, it means the command was not triggered from a tree item
      if (!dependency) {
        vscode.window.showErrorMessage(
          "Please select a package to update from the dependencies view"
        );
        return;
      }

      await dependencyProvider.updatePackage(dependency);
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
  
  // Register the check vulnerabilities command
  disposable = vscode.commands.registerCommand(
    "pkg-version.checkVulnerabilities",
    async () => {
      // Get the Snyk client
      const snykClient = getSnykClient();
      
      // Check if token is configured
      const isTokenValid = await snykClient.isTokenValid();
      if (!isTokenValid) {
        const configureToken = "Configure API Token";
        const response = await vscode.window.showErrorMessage(
          "Snyk API token not configured or invalid. Please configure a valid token to check for vulnerabilities.",
          configureToken
        );
        
        if (response === configureToken) {
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "pkgVersion.snykApiToken"
          );
        }
        return;
      }
      
      // Get all dependencies from the provider
      const allDependencies = await dependencyProvider.getAllDependencies();
      
      // Filter out non-individual dependencies (package files, categories, etc.)
      const packageDependencies = allDependencies.filter(
        (dep: Dependency) => dep.label && dep.packageManager && !dep.children
      );
      
      if (packageDependencies.length === 0) {
        vscode.window.showInformationMessage(
          "No package dependencies found to check for vulnerabilities."
        );
        return;
      }
      
      // Show progress indicator
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Checking for vulnerabilities",
          cancellable: true,
        },
        async (progress, token) => {
          let vulnerablePackages = 0;
          let checkedPackages = 0;
          let totalVulnerabilities = 0;
          
          // Calculate increment step for progress bar
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
            
            // Skip if no version
            if (!dependency.label || !dependency.packageManager) {
              continue;
            }
            
            // Check for vulnerabilities
            const vulnerabilities = await snykClient.checkPackageVulnerabilities(
              dependency.label,
              dependency.version || "",
              dependency.packageManager || ""
            );
            
            // Update the dependency with vulnerability info
            if (vulnerabilities && vulnerabilities.length > 0) {
              dependency.vulnerabilities = vulnerabilities;
              vulnerablePackages++;
              totalVulnerabilities += vulnerabilities.length;
            }
            
            checkedPackages++;
          }
          
          // Show summary
          if (vulnerablePackages > 0) {
            const viewDetails = "View Details";
            const response = await vscode.window.showWarningMessage(
              `Found ${totalVulnerabilities} vulnerabilities in ${vulnerablePackages} packages.`,
              viewDetails
            );
            
            if (response === viewDetails) {
              // Refresh view to show vulnerability indicators
              dependencyProvider.refresh();
            }
          } else {
            vscode.window.showInformationMessage(
              `No vulnerabilities found in ${checkedPackages} checked packages.`
            );
          }
          
          // Refresh the view to show vulnerability status
          dependencyProvider.refresh();
        }
      );
    }
  );
  context.subscriptions.push(disposable);
  
  // Initial update of dependency counter in the status bar
  updateDependencyStatusCounter(dependencyProvider);
}

/**
 * Updates the status bar counter displaying total dependencies and 
 * how many updates are available.
 * 
 * @param provider The dependency provider to get dependency information from
 */
async function updateDependencyStatusCounter(provider: DependencyProvider) {
  try {
    // Get all outdated dependencies
    const outdatedDeps = await provider.getAllOutdatedDependencies();
    
    if (outdatedDeps.length > 0) {
      // Show count of outdated dependencies with icon
      dependencyStatusBarItem.text = `$(arrow-up) ${outdatedDeps.length} updates available`;
      dependencyStatusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      dependencyStatusBarItem.show();
    } else {
      // Check if we have any dependencies at all
      // This is a simplified check that doesn't count all dependencies
      // A more thorough check would require scanning all package files
      dependencyStatusBarItem.text = `$(check) Dependencies up to date`;
      dependencyStatusBarItem.backgroundColor = undefined;
      dependencyStatusBarItem.show();
    }
  } catch (error) {
    console.error("Error updating dependency status bar:", error);
    // In case of error, hide the status bar item to avoid showing incorrect information
    dependencyStatusBarItem.hide();
  }
}

/**
 * Called when the extension is deactivated.
 * Use this to clean up any resources the extension has allocated.
 */
export function deactivate() {
  // Nothing to clean up at this time
  console.log("pkg-version extension deactivated");
}

module.exports = {
  activate,
  deactivate,
};
