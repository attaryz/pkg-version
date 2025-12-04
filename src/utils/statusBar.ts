import * as vscode from "vscode";
import { DependencyProvider } from "../dependencyProvider";

let dependencyStatusBarItem: vscode.StatusBarItem;
let updateTimeout: NodeJS.Timeout | undefined;
let isUpdating = false;

/**
 * Initialize the status bar item
 */
export function initializeStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  dependencyStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  dependencyStatusBarItem.command = "pkg-version.refresh";
  dependencyStatusBarItem.text = "$(package) Loading...";
  dependencyStatusBarItem.show();
  
  context.subscriptions.push(dependencyStatusBarItem);
  
  return dependencyStatusBarItem;
}

/**
 * Updates the unified status bar item displaying dependency statistics.
 * Shows vulnerability count and package update information.
 * Only counts already-loaded dependencies, does NOT trigger version fetching.
 * Debounced to prevent excessive updates.
 * 
 * @param provider The dependency provider to get dependency information from
 */
export async function updateDependencyStatusCounter(provider: DependencyProvider): Promise<void> {
  // Debounce: clear existing timeout and set a new one
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }

  // If already updating, skip this call
  if (isUpdating) {
    console.log("[StatusBar] Update already in progress, skipping...");
    return;
  }

  updateTimeout = setTimeout(async () => {
    try {
      isUpdating = true;
      console.log("[StatusBar] Updating status bar...");

      // Get all dependencies that are already loaded (no version fetching)
      const allDeps = await provider.getAllDependencies();
    
    const updateCounts = {
      major: 0,
      minor: 0,
      patch: 0,
      deprecated: 0
    };

    // Count updates and deprecated packages from already-loaded data
    allDeps.forEach(dep => {
      // Only count if we have version info (already loaded)
      if (dep.latestVersion && dep.updateType && dep.updateType !== "none") {
        if (dep.updateType === "major") {
          updateCounts.major++;
        } else if (dep.updateType === "minor") {
          updateCounts.minor++;
        } else if (dep.updateType === "patch") {
          updateCounts.patch++;
        }
      }
      
      if (dep.deprecated) {
        updateCounts.deprecated++;
      }
    });

    let vulnerabilityCount = 0;
    let criticalCount = 0;
    allDeps.forEach(dep => {
      if (dep.vulnerabilities && dep.vulnerabilities.length > 0) {
        vulnerabilityCount += dep.vulnerabilities.length;
        const hasCritical = dep.vulnerabilities.some(v => v.severity === 'critical' || v.severity === 'high');
        if (hasCritical) {
          criticalCount++;
        }
      }
    });

    const totalUpdates = updateCounts.major + updateCounts.minor + updateCounts.patch + updateCounts.deprecated;

    if (totalUpdates === 0 && vulnerabilityCount === 0) {
      dependencyStatusBarItem.text = "  $(package) $(check) Up to date  ";
      dependencyStatusBarItem.tooltip = "All dependencies are up to date - Click to refresh";
      dependencyStatusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.prominentBackground");
    } else {
      const statusParts = [];
      if (updateCounts.major > 0) {
        statusParts.push(`${updateCounts.major} major`);
      }
      if (updateCounts.minor > 0) {
        statusParts.push(`${updateCounts.minor} minor`);
      }
      if (updateCounts.patch > 0) {
        statusParts.push(`${updateCounts.patch} patch`);
      }
      if (updateCounts.deprecated > 0) {
        statusParts.push(`${updateCounts.deprecated} deprecated`);
      }
      if (vulnerabilityCount > 0) {
        statusParts.push(`$(shield) ${vulnerabilityCount} vuln${vulnerabilityCount === 1 ? '' : 's'}`);
      }
      
      const updateText = totalUpdates > 0 ? `Package updates: ${statusParts.join(", ")}` : statusParts.join(", ");
      dependencyStatusBarItem.text = `  $(package) ${updateText}  `;
      
      const tooltipParts = [];
      if (totalUpdates > 0) {
        tooltipParts.push(`${totalUpdates} package update${totalUpdates === 1 ? '' : 's'} available`);
      }
      if (vulnerabilityCount > 0) {
        tooltipParts.push(`${vulnerabilityCount} vulnerabilit${vulnerabilityCount === 1 ? 'y' : 'ies'} found`);
        if (criticalCount > 0) {
          tooltipParts.push(`${criticalCount} critical/high severity`);
        }
      }
      dependencyStatusBarItem.tooltip = tooltipParts.join(", ") + " - Click to refresh";
      
      if (criticalCount > 0) {
        dependencyStatusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      } else if (vulnerabilityCount > 0 || updateCounts.major > 0 || updateCounts.deprecated > 0) {
        dependencyStatusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      } else if (updateCounts.minor > 0) {
        dependencyStatusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      } else {
        dependencyStatusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.prominentBackground");
      }
    }
    
      dependencyStatusBarItem.show();
      console.log("[StatusBar] Status bar updated successfully");

    } catch (error) {
      console.error("[StatusBar] Failed to update dependency status counter:", error);
      dependencyStatusBarItem.text = "$(package) Error";
      dependencyStatusBarItem.tooltip = "Failed to load dependency information";
    } finally {
      isUpdating = false;
    }
  }, 500); // 500ms debounce delay
}
