import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { Dependency } from "../models/dependency";
import { getExcludePattern } from "../utils/fileUtils";

/**
 * Updates a Dart/Flutter package in pubspec.yaml.
 *
 * @param dependency - The Dart/Flutter dependency to update
 * @returns True if the update was successful, false otherwise
 */
export async function updatePubDevPackage(dependency: Dependency): Promise<boolean> {
  if (!dependency.latestVersion) {
    vscode.window.showErrorMessage(
      "Cannot update this package: missing latest version information"
    );
    return false;
  }

  const pubspecFiles = await vscode.workspace.findFiles(
    "**/pubspec.yaml",
    getExcludePattern()
  );

  if (pubspecFiles.length === 0) {
    vscode.window.showErrorMessage(
      "No pubspec.yaml file found in the workspace"
    );
    return false;
  }

  let targetFile: vscode.Uri;

  if (pubspecFiles.length > 1) {
    // If multiple pubspec.yaml files, let user choose which one to update
    const items = pubspecFiles.map((file) => ({
      label: vscode.workspace.asRelativePath(file),
      file,
    }));

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Select pubspec.yaml file to update",
    });

    if (!selection) {
      return false;
    }

    targetFile = selection.file;
  } else {
    // Only one pubspec.yaml, use it
    targetFile = pubspecFiles[0];
  }

  try {
    const document = await vscode.workspace.openTextDocument(targetFile);
    const textContent = document.getText();

    // Parse YAML content
    const pubspecYaml: any = yaml.load(textContent);
    let updated = false;

    // Update in dependencies and dev_dependencies sections if present
    const sections = [
      "dependencies",
      "dev_dependencies",
      "dependency_overrides",
    ];

    for (const section of sections) {
      if (pubspecYaml[section] && pubspecYaml[section][dependency.label]) {
        const currentValue = pubspecYaml[section][dependency.label];

        // Handle different formats of dependencies in pubspec.yaml
        if (typeof currentValue === "string") {
          // Simple version string like "^1.0.0"
          const prefix = currentValue.match(/^[~^>=<]/)?.[0] || "";
          pubspecYaml[section][
            dependency.label
          ] = `${prefix}${dependency.latestVersion}`;
          updated = true;
        } else if (typeof currentValue === "object") {
          // Complex dependency spec (hosted, git, path, etc.)
          if (currentValue.version) {
            const prefix = currentValue.version.match(/^[~^>=<]/)?.[0] || "";
            pubspecYaml[section][
              dependency.label
            ].version = `${prefix}${dependency.latestVersion}`;
            updated = true;
          }
        }
      }
    }

    if (!updated) {
      vscode.window.showWarningMessage(
        `Package ${
          dependency.label
        } not found in ${vscode.workspace.asRelativePath(targetFile)}`
      );
      return false;
    }

    // Convert back to YAML
    const updatedYaml = yaml.dump(pubspecYaml, { lineWidth: -1 });

    // Write the updated pubspec.yaml back to disk
    const edit = new vscode.WorkspaceEdit();
    const entireRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    edit.replace(targetFile, entireRange, updatedYaml);

    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
      vscode.window.showInformationMessage(
        `Updated ${dependency.label} to ${dependency.latestVersion}`
      );
      return true;
    } else {
      vscode.window.showErrorMessage(`Failed to update ${dependency.label}`);
      return false;
    }
  } catch (error: any) {
    console.error("Error updating pubspec.yaml:", error);
    vscode.window.showErrorMessage(
      `Error updating pubspec.yaml: ${error.message}`
    );
    return false;
  }
} 