import * as vscode from "vscode";
import * as cp from "child_process";
import * as util from "util";

// Cache the result to avoid checking multiple times
let isComposerAvailableCache: boolean | undefined = undefined;

/**
 * Checks if Composer is available in the system PATH
 * @returns Promise resolving to true if Composer is available, false otherwise
 */
export async function isComposerAvailable(): Promise<boolean> {
  // Return cached result if we already checked
  if (isComposerAvailableCache !== undefined) {
    return isComposerAvailableCache;
  }

  try {
    // Try to run 'composer --version' to check if it's available
    const execPromise = util.promisify(cp.exec);
    await execPromise("composer --version");
    
    // If we get here, Composer is available
    isComposerAvailableCache = true;
    return true;
  } catch (error) {
    console.error("Composer is not available:", error);
    isComposerAvailableCache = false;
    return false;
  }
}

/**
 * Shows a message to the user about installing Composer if it's not available
 */
export function showComposerNotAvailableMessage(): void {
  vscode.window.showWarningMessage(
    "Composer is not installed or not in PATH. Some functionality will be limited.",
    "Learn More"
  ).then(selection => {
    if (selection === "Learn More") {
      vscode.env.openExternal(vscode.Uri.parse("https://getcomposer.org/download/"));
    }
  });
} 