import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { Dependency } from "../models/dependency";
import { fetchLatestPubDevVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a pubspec.yaml file and extracts all Dart/Flutter dependencies.
 * Creates dependency objects WITHOUT fetching latest versions for faster initial load.
 * Versions will be fetched in the background by the DependencyProvider.
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
    let deps: Dependency[] = [];

    const processPubspecDependencies = (
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

        // Create dependency without fetching version (will be loaded in background)
        deps.push(new Dependency(
          packageName,
          currentVersion,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined, // latestVersion - will be loaded in background
          "none", // updateType - will be determined when version is loaded
          "pub",
          pubspecYamlUri.fsPath,
          isDev
        ));
      }
    };

    // Process regular and dev dependencies
    processPubspecDependencies(pubspec.dependencies, false);
    processPubspecDependencies(pubspec.dev_dependencies, true);

    return deps;
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