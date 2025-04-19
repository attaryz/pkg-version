import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { Dependency } from "../models/dependency";
import { fetchLatestPubDevVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a pubspec.yaml file and extracts all Dart/Flutter dependencies.
 * For each dependency, fetches the latest version from Pub.dev and
 * determines the update type.
 *
 * Handles various types of dependencies including:
 * - Version constraints (>=1.0.0 <2.0.0)
 * - SDK dependencies (sdk: flutter)
 * - Path dependencies (path: ../my_package)
 * - Git dependencies (git: {url: ...})
 *
 * @param pubspecYamlUri - URI of the pubspec.yaml file
 * @returns Promise resolving to array of dependencies
 */
export async function getDepsInPubspecYaml(
  pubspecYamlUri: vscode.Uri
): Promise<Dependency[]> {
  if (!pathExists(pubspecYamlUri.fsPath)) {
    return Promise.resolve([]);
  }

  try {
    const buffer = await vscode.workspace.fs.readFile(pubspecYamlUri);
    const content = Buffer.from(buffer).toString("utf8");
    const pubspec = yaml.load(content) as any; // Use 'as any' for simplicity
    let depsPromises: Promise<Dependency | null>[] = [];

    const processPubspecDependencies = async (
      dependencies: { [key: string]: any } | undefined,
      isDev: boolean
    ) => {
      if (!dependencies) return;

      for (const packageName of Object.keys(dependencies)) {
        const depValue = dependencies[packageName];
        // Dart/Flutter dependencies can be specified in several ways:
        // 1. String version: "^1.0.0"
        // 2. SDK constraint: "sdk: flutter"
        // 3. Path/Git/Hosted dependency: {path: "../my_package"}

        // Skip SDK dependencies
        if (typeof depValue === "object" && depValue.sdk) {
          continue;
        }

        // Handle different version formats
        let currentVersion: string;
        if (typeof depValue === "string") {
          currentVersion = depValue;
        } else if (typeof depValue === "object") {
          // For complex dependencies (git, path, etc.), use a custom label
          if (depValue.git) {
            currentVersion = `git:${
              depValue.git.url || depValue.git.toString()
            }`;
          } else if (depValue.path) {
            currentVersion = `path:${depValue.path}`;
          } else if (depValue.hosted) {
            currentVersion = `hosted:${depValue.hosted.url}`;
          } else if (depValue.version) {
            currentVersion = depValue.version;
          } else {
            currentVersion = JSON.stringify(depValue);
          }
        } else {
          currentVersion = "unknown";
        }

        // Only attempt to fetch updates for string versions
        // and skip path/git dependencies
        const canCheckForUpdates =
          typeof depValue === "string" &&
          !currentVersion.startsWith("path:") &&
          !currentVersion.startsWith("git:") &&
          !currentVersion.startsWith("hosted:");

        depsPromises.push(
          (async () => {
            let latestVersion: string | undefined = undefined;

            if (canCheckForUpdates) {
              latestVersion = await fetchLatestPubDevVersion(packageName);
            }

            if (latestVersion) {
              const updateType = getUpdateType(currentVersion, latestVersion);
              return new Dependency(
                packageName,
                currentVersion,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                latestVersion,
                updateType,
                "dart",
                pubspecYamlUri.fsPath,
                isDev
              );
            } else {
              return new Dependency(
                packageName,
                currentVersion,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                "none",
                "dart",
                pubspecYamlUri.fsPath,
                isDev
              );
            }
          })()
        );
      }
    };

    // Process regular and dev dependencies
    await processPubspecDependencies(pubspec.dependencies, false);
    await processPubspecDependencies(pubspec.dev_dependencies, true);

    const resolvedDeps = await Promise.all(depsPromises);
    return resolvedDeps.filter(
      (d): d is Dependency => d !== null
    );
  } catch (err: any) {
    console.error(`Error reading or parsing ${pubspecYamlUri.fsPath}:`, err);
    // Check if it's a YAMLException for a more specific message
    if (err.name === "YAMLException") {
      vscode.window.showErrorMessage(
        `Failed to parse YAML in ${vscode.workspace.asRelativePath(
          pubspecYamlUri
        )}: ${err.message}`
      );
    } else {
      vscode.window.showErrorMessage(
        `Failed to read dependencies from ${vscode.workspace.asRelativePath(
          pubspecYamlUri
        )}`
      );
    }
    return [];
  }
} 