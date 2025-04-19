import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { getExcludePattern } from "../utils/fileUtils";

/**
 * Updates a Composer package in composer.json.
 *
 * @param dependency - The Composer dependency to update
 * @returns True if the update was successful, false otherwise
 */
export async function updateComposerPackage(
  dependency: Dependency
): Promise<boolean> {
  if (!dependency.latestVersion) {
    vscode.window.showErrorMessage(
      "Cannot update this package: missing latest version information"
    );
    return false;
  }

  // Similar to npm update, find composer.json and update it
  const composerJsonFiles = await vscode.workspace.findFiles(
    "**/composer.json",
    getExcludePattern()
  );

  if (composerJsonFiles.length === 0) {
    vscode.window.showErrorMessage(
      "No composer.json file found in the workspace"
    );
    return false;
  }

  let targetFile: vscode.Uri;

  if (composerJsonFiles.length > 1) {
    // If multiple composer.json files, let user choose which one to update
    const items = composerJsonFiles.map((file) => ({
      label: vscode.workspace.asRelativePath(file),
      file,
    }));

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Select composer.json file to update",
    });

    if (!selection) {
      return false;
    }

    targetFile = selection.file;
  } else {
    // Only one composer.json, use it
    targetFile = composerJsonFiles[0];
  }

  try {
    const document = await vscode.workspace.openTextDocument(targetFile);
    const composerJson = JSON.parse(document.getText());

    let updated = false;

    // Update in require and require-dev sections if present
    const sections = ["require", "require-dev"];

    for (const section of sections) {
      if (composerJson[section] && composerJson[section][dependency.label]) {
        // Preserve version constraints (^, ~, etc.)
        const currentVersion = composerJson[section][dependency.label];
        const prefix = currentVersion.match(/^[~^>=<]/)?.[0] || "";
        composerJson[section][
          dependency.label
        ] = `${prefix}${dependency.latestVersion}`;
        updated = true;
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

    // Write the updated composer.json back to disk
    const edit = new vscode.WorkspaceEdit();
    const entireRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    edit.replace(
      targetFile,
      entireRange,
      JSON.stringify(composerJson, null, 2)
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
    console.error("Error updating composer.json:", error);
    vscode.window.showErrorMessage(
      `Error updating composer.json: ${error.message}`
    );
    return false;
  }
} 