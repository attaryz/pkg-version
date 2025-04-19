import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { fetchLatestPypiVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a requirements.txt file and extracts all Python dependencies.
 * For each dependency, fetches the latest version from PyPI and
 * determines the update type.
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
    const depsPromises: Promise<Dependency | null>[] = [];

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

          depsPromises.push(
            (async () => {
              const latestVersion = await fetchLatestPypiVersion(name);
              if (latestVersion) {
                // Note: currentVersion here is the *specifier*, not necessarily a fixed version.
                // getUpdateType might not be accurate if currentVersion is a range.
                // For a simple indicator, we compare against the latest available.
                const updateType = getUpdateType(
                  currentVersion,
                  latestVersion
                );
                return new Dependency(
                  name,
                  currentVersion, // Show the original specifier
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  latestVersion,
                  updateType,
                  "pypi",
                  requirementsTxtUri.fsPath
                );
              } else {
                return new Dependency(
                  name,
                  currentVersion,
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  undefined,
                  "none",
                  "pypi",
                  requirementsTxtUri.fsPath
                );
              }
            })()
          );
        }
      }
    }
    const resolvedDeps = await Promise.all(depsPromises);
    return resolvedDeps.filter((d): d is Dependency => d !== null);
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