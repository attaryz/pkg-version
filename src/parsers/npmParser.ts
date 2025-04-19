import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { fetchLatestNpmVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a package.json file and extracts all dependencies with their versions.
 * For each dependency, fetches the latest version from npm registry and
 * determines the update type.
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
    let depsPromises: Promise<Dependency | null>[] = []; // Store promises

    const processDependencies = async (
      dependencies: { [key: string]: string } | undefined,
      isDev: boolean
    ) => {
      if (!dependencies) return;

      for (const moduleName of Object.keys(dependencies)) {
        const currentVersion = dependencies[moduleName];
        // Push the promise for creating the dependency
        depsPromises.push(
          (async () => {
            const latestVersion = await fetchLatestNpmVersion(moduleName);
            if (latestVersion) {
              const updateType = getUpdateType(currentVersion, latestVersion);
              return new Dependency(
                moduleName,
                currentVersion,
                vscode.TreeItemCollapsibleState.None,
                undefined, // No resourceUri for individual deps
                latestVersion,
                updateType,
                "npm",
                packageJsonUri.fsPath,
                isDev
              );
            } else {
              // If fetch failed, create dependency without update info
              return new Dependency(
                moduleName,
                currentVersion,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                "none",
                "npm",
                packageJsonUri.fsPath,
                isDev
              );
            }
          })()
        );
      }
    };

    await processDependencies(json.dependencies, false);
    await processDependencies(json.devDependencies, true);
    // TODO: Add support for other dependency types (peerDependencies, optionalDependencies)

    // Wait for all dependency fetch/creation promises to resolve
    const resolvedDeps = await Promise.all(depsPromises);
    // Filter out any null results (though currently not returning null)
    return resolvedDeps.filter((d): d is Dependency => d !== null);
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