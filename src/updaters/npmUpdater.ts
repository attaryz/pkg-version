import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { getExcludePattern } from "../utils/fileUtils";

/**
 * Updates an npm package in package.json.
 *
 * @param dependency - The npm dependency to update
 * @returns True if the update was successful, false otherwise
 */
export async function updateNpmPackage(dependency: Dependency): Promise<boolean> {
  if (!dependency.latestVersion) {
    vscode.window.showErrorMessage(
      "Cannot update this package: missing latest version information"
    );
    return false;
  }

  if (!dependency.parentFile) {
    // Find the package.json from workspace
    const packageJsonFiles = await vscode.workspace.findFiles(
      "**/package.json",
      getExcludePattern()
    );

    if (packageJsonFiles.length === 0) {
      vscode.window.showErrorMessage(
        "No package.json file found in the workspace"
      );
      return false;
    }

    if (packageJsonFiles.length > 1) {
      // If multiple package.json files, let user choose which one to update
      const items = packageJsonFiles.map((file) => ({
        label: vscode.workspace.asRelativePath(file),
        file,
      }));

      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select package.json file to update",
      });

      if (!selection) {
        return false;
      }

      return await updatePackageJsonDependency(
        selection.file,
        dependency
      );
    } else {
      // Only one package.json, use it
      return await updatePackageJsonDependency(
        packageJsonFiles[0],
        dependency
      );
    }
  } else {
    // Use the parent file directly
    return await updatePackageJsonDependency(
      vscode.Uri.file(dependency.parentFile),
      dependency
    );
  }
}

/**
 * Updates a dependency in a specific package.json file.
 *
 * @param packageJsonUri - URI of the package.json file
 * @param dependency - The dependency to update
 * @returns True if the update was successful, false otherwise
 */
export async function updatePackageJsonDependency(
  packageJsonUri: vscode.Uri,
  dependency: Dependency
): Promise<boolean> {
  try {
    const document = await vscode.workspace.openTextDocument(packageJsonUri);
    const packageJson = JSON.parse(document.getText());

    let updated = false;

    // Update in dependencies, devDependencies, and optionalDependencies if present
    const sections = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ];

    for (const section of sections) {
      if (packageJson[section] && packageJson[section][dependency.label]) {
        const prefix =
          packageJson[section][dependency.label].match(/^[~^>=<]/)?.[0] || "";
        packageJson[section][
          dependency.label
        ] = `${prefix}${dependency.latestVersion}`;
        updated = true;
      }
    }

    if (!updated) {
      vscode.window.showWarningMessage(
        `Package ${
          dependency.label
        } not found in ${vscode.workspace.asRelativePath(packageJsonUri)}`
      );
      return false;
    }

    // Write the updated package.json back to disk
    const edit = new vscode.WorkspaceEdit();
    const entireRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    edit.replace(
      packageJsonUri,
      entireRange,
      JSON.stringify(packageJson, null, 2)
    );

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
    console.error("Error updating package.json:", error);
    vscode.window.showErrorMessage(
      `Error updating package.json: ${error.message}`
    );
    return false;
  }
} 