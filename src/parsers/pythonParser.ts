import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { fetchLatestPypiVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a requirements.txt file and extracts all Python dependencies.
 * Creates dependency objects WITHOUT fetching latest versions for faster initial load.
 * Versions will be fetched in the background by the DependencyProvider.
 *
 * @param requirementsTxtUri - URI of the requirements.txt file
 * @returns Promise resolving to array of dependencies
 */
export async function getDepsInRequirementsTxt(
  requirementsTxtUri: vscode.Uri
): Promise<Dependency[]> {
  if (!pathExists(requirementsTxtUri.fsPath)) {
    return Promise.resolve([]);
  }
  try {
    const buffer = await vscode.workspace.fs.readFile(requirementsTxtUri);
    const content = Buffer.from(buffer).toString("utf8");
    const lines = content.split(/\r?\n/); // Split by newline, handling CRLF and LF
    const deps: Dependency[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      // Skip empty lines and comments
      if (trimmedLine && !trimmedLine.startsWith("#")) {
        // Ignore lines with options like -r, -e, --hash, or local paths starting with .
        if (trimmedLine.startsWith("-") || trimmedLine.startsWith("."))
          continue;

        // Basic parsing: assumes format like package==version, package>=version, package
        // More robust parsing might be needed for complex cases (e.g., URLs, extras)
        const match = trimmedLine.match(/^([^=><!~\s]+)\s*([=><!~]=?.*)?/);
        if (match) {
          const name = match[1].trim();
          // Version specifier might be complex (e.g., >=1.0,<2.0).
          // For simplicity, we'll pass the whole specifier as 'currentVersion'.
          // A more accurate comparison would require parsing the specifier.
          const currentVersion = match[2] ? match[2].trim() : "latest";

          // Create dependency without fetching version (will be loaded in background)
          deps.push(new Dependency(
            name,
            currentVersion, // Show the original specifier
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined, // latestVersion - will be loaded in background
            "none", // updateType - will be determined when version is loaded
            "pip",
            requirementsTxtUri.fsPath
          ));
        }
      }
    }
    return deps;
  } catch (err: any) {
    console.error(
      `Error reading or parsing ${requirementsTxtUri.fsPath}:`,
      err
    );
    vscode.window.showErrorMessage(
      `Failed to read dependencies from ${vscode.workspace.asRelativePath(
        requirementsTxtUri
      )}`
    );
    return [];
  }
} 