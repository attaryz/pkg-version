// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode"
import { DependencyProvider } from "./dependencyProvider" // Import the provider
import * as path from "path"

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
    "**/.git/**"
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
    await config.update("excludeFolders", currentExclusions, vscode.ConfigurationTarget.Global);
    console.log("Updated default exclusions to ensure nested vendor folders and other critical folders are excluded");
  }
  
  // Ensure scanVendorDirectory is set to true by default
  const scanVendorDirectory = config.get("scanVendorDirectory");
  if (scanVendorDirectory === undefined) {
    await config.update("scanVendorDirectory", true, vscode.ConfigurationTarget.Global);
    console.log("Set scanVendorDirectory to true by default");
  }
  
  // Ensure composerPackageDetection is set to "auto" by default
  const composerPackageDetection = config.get("composerPackageDetection");
  if (composerPackageDetection === undefined) {
    await config.update("composerPackageDetection", "auto", vscode.ConfigurationTarget.Global);
    console.log("Set composerPackageDetection to 'auto' by default");
  }
}

/**
 * Activates the extension and registers all commands and providers.
 * Sets up the dependency tree view and related functionality.
 * 
 * @param {vscode.ExtensionContext} context - The extension context provided by VS Code
 */
function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "pkg-version" is now active!')
  
  // Ensure default exclusions are set
  ensureDefaultExclusions().then(() => {
    console.log("Default exclusions verified");
  });

  // Register the checkUpdates command defined in package.json
  let disposable = vscode.commands.registerCommand(
    "pkg-version.checkUpdates",
    function () {
      vscode.window.showInformationMessage("Checking for package updates!")
      // TODO: Implement full package update check functionality
      // This should scan all package files and report outdated dependencies
    }
  )

  context.subscriptions.push(disposable)

  // Get workspace root path for the provider
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined
  
  // Register the TreeView provider
  const dependencyProvider = new DependencyProvider(rootPath)
  vscode.window.registerTreeDataProvider(
    "packageDependencies",
    dependencyProvider
  )

  // Register refresh command for the dependency tree view
  disposable = vscode.commands.registerCommand(
    "pkg-version.refreshDependencies", 
    () => dependencyProvider.refresh()
  );
  context.subscriptions.push(disposable);
  
  // Register update package command
  disposable = vscode.commands.registerCommand(
    "pkg-version.updatePackage",
    async (dependency) => {
      // If dependency is not provided, it means the command was not triggered from a tree item
      if (!dependency) {
        vscode.window.showErrorMessage("Please select a package to update from the dependencies view");
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
          placeHolder: "This will update all outdated packages. Are you sure you want to continue?",
          canPickMany: false
        }
      );
      
      if (choice !== "Yes, update all packages") {
        return;
      }

      // Get all outdated dependencies from the provider
      const allDependencies = await dependencyProvider.getAllOutdatedDependencies();
      
      if (allDependencies.length === 0) {
        vscode.window.showInformationMessage("No outdated packages found.");
        return;
      }
      
      // Show progress indicator
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Updating packages",
          cancellable: true
        },
        async (progress, token) => {
          let successCount = 0;
          let failCount = 0;
          
          // Calculate increment step for progress bar
          const incrementStep = 100 / allDependencies.length;
          
          for (let i = 0; i < allDependencies.length; i++) {
            if (token.isCancellationRequested) {
              vscode.window.showInformationMessage("Package update operation cancelled.");
              break;
            }
            
            const dependency = allDependencies[i];
            progress.report({ 
              message: `Updating ${dependency.label} (${i + 1}/${allDependencies.length})`,
              increment: incrementStep 
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
    async (folder: vscode.Uri) => {
      if (!folder) {
        // If no folder is provided via context menu, show folder picker
        const folderUris = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: "Select Folder to Exclude"
        });
        
        if (!folderUris || folderUris.length === 0) {
          return;
        }
        folder = folderUris[0];
      }
      
      const configuration = vscode.workspace.getConfiguration("pkgVersion");
      const excludeFolders: string[] = configuration.get("excludeFolders") || [];
      
      // Construct a glob pattern for the selected folder relative to workspace
      let relativePath: string;
      if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        relativePath = path.relative(workspaceFolder.uri.fsPath, folder.fsPath);
        relativePath = relativePath.replace(/\\/g, '/'); // Normalize path for glob pattern
      } else {
        relativePath = folder.fsPath;
      }
      
      // Create a glob pattern that excludes the folder and all its contents
      const globPattern = `**/${relativePath}/**`;
      
      // Check if already excluded
      if (excludeFolders.includes(globPattern)) {
        vscode.window.showInformationMessage(`Folder '${relativePath}' is already excluded.`);
        return;
      }
      
      // Add the new exclude pattern
      excludeFolders.push(globPattern);
      
      // Update configuration
      await configuration.update("excludeFolders", excludeFolders, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(`Folder '${relativePath}' excluded from package checks.`);
      
      // Refresh the tree view
      dependencyProvider.refresh();
    }
  );
  context.subscriptions.push(disposable);
  
  /**
   * Command to manage folder exclusions by displaying a list of currently
   * excluded folders and allowing users to remove them.
   */
  disposable = vscode.commands.registerCommand(
    "pkg-version.manageExclusions",
    async () => {
      const configuration = vscode.workspace.getConfiguration("pkgVersion");
      const excludeFolders: string[] = configuration.get("excludeFolders") || [];
      
      // Create quick pick items for each excluded folder
      const quickPickItems = excludeFolders.map(folder => ({
        label: folder,
        description: "Remove this exclusion"
      }));
      
      if (quickPickItems.length === 0) {
        vscode.window.showInformationMessage("No folders are currently excluded.");
        return;
      }
      
      // Show quick pick to select which exclusion to remove
      const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: "Select a folder exclusion to remove",
        canPickMany: true
      });
      
      if (!selected || selected.length === 0) {
        return;
      }
      
      // Remove selected exclusions
      const selectedPaths = selected.map(item => item.label);
      const newExcludeFolders = excludeFolders.filter(folder => !selectedPaths.includes(folder));
      
      // Update configuration
      await configuration.update("excludeFolders", newExcludeFolders, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(`Removed ${selected.length} folder exclusion(s).`);
      
      // Refresh the tree view
      dependencyProvider.refresh();
    }
  );
  context.subscriptions.push(disposable);

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration('pkgVersion.excludeFolders') ||
        e.affectsConfiguration('pkgVersion.scanVendorDirectory') ||
        e.affectsConfiguration('pkgVersion.composerPackageDetection')
      ) {
        console.log("Package Version configuration changed, refreshing dependencies view");
        dependencyProvider.refresh();
      }
    })
  );

  // TODO: Add support for multi-root workspaces
  // Current implementation only checks the first workspace folder

  // TODO: Add notification system for outdated dependencies
  // Consider implementing a status bar item to show outdated packages count
}

/**
 * Called when the extension is deactivated.
 * Currently no cleanup needed, but this could change in future versions.
 */
function deactivate() {
  // TODO: Add cleanup logic if needed in the future
}

module.exports = {
  activate,
  deactivate,
}
