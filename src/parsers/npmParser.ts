import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { fetchLatestNpmVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a package.json file and extracts all dependencies with their versions.
 * Creates dependency objects WITHOUT fetching latest versions for faster initial load.
 * Versions will be fetched in the background by the DependencyProvider.
 *
 * @param packageJsonUri - URI of the package.json file
 * @returns Promise resolving to array of dependencies
 */
export async function getDepsInPackageJson(
  packageJsonUri: vscode.Uri
): Promise<Dependency[]> {
  // Return Promise<Dependency[]>
  if (!pathExists(packageJsonUri.fsPath)) {
    return Promise.resolve([]);
  }
  try {
    const buffer = await vscode.workspace.fs.readFile(packageJsonUri);
    const content = Buffer.from(buffer).toString("utf8");
    const json = JSON.parse(content);
    let deps: Dependency[] = [];

    const processDependencies = (
      dependencies: { [key: string]: string } | undefined,
      isDev: boolean
    ) => {
      if (!dependencies) return;

      for (const moduleName of Object.keys(dependencies)) {
        const currentVersion = dependencies[moduleName];
        // Create dependency without fetching version (will be loaded in background)
        deps.push(new Dependency(
          moduleName,
          currentVersion,
          vscode.TreeItemCollapsibleState.None,
          undefined, // No resourceUri for individual deps
          undefined, // latestVersion - will be loaded in background
          "none", // updateType - will be determined when version is loaded
          "npm",
          packageJsonUri.fsPath,
          isDev,
          undefined, // vulnerabilities
          false // deprecated - will be determined when version is loaded
        ));
      }
    };

    processDependencies(json.dependencies, false);
    processDependencies(json.devDependencies, true);
    // TODO: Add support for other dependency types (peerDependencies, optionalDependencies)

    return deps;
  } catch (err: any) {
    console.error(`Error reading or parsing ${packageJsonUri.fsPath}:`, err);
    vscode.window.showErrorMessage(
      `Failed to read dependencies from ${vscode.workspace.asRelativePath(
        packageJsonUri
      )}`
    );
    return []; // Return empty array on error
  }
} 