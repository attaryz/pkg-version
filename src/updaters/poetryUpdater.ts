import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { getExcludePattern } from "../utils/fileUtils";

/**
 * Updates a Poetry package in pyproject.toml.
 *
 * @param dependency - The Poetry dependency to update
 * @returns True if the update was successful, false otherwise
 */
export async function updatePoetryPackage(dependency: Dependency): Promise<boolean> {
  if (!dependency.latestVersion) {
    vscode.window.showErrorMessage(
      "Cannot update this package: missing latest version information"
    );
    return false;
  }

  const pyprojectFiles = await vscode.workspace.findFiles(
    "**/pyproject.toml",
    getExcludePattern()
  );

  if (pyprojectFiles.length === 0) {
    vscode.window.showErrorMessage(
      "No pyproject.toml file found in the workspace"
    );
    return false;
  }

  let targetFile: vscode.Uri;

  if (pyprojectFiles.length > 1) {
    // If multiple pyproject.toml files, let user choose which one to update
    const items = pyprojectFiles.map((file) => ({
      label: vscode.workspace.asRelativePath(file),
      file,
    }));

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Select pyproject.toml file to update",
    });

    if (!selection) {
      return false;
    }

    targetFile = selection.file;
  } else {
    // Only one pyproject.toml, use it
    targetFile = pyprojectFiles[0];
  }

  try {
    const document = await vscode.workspace.openTextDocument(targetFile);
    const textContent = document.getText();
    const lines = textContent.split(/\r?\n/);
    let updated = false;

    // Track if we're in a dependencies section
    let inDependenciesSection = false;
    let inGroupDependenciesSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check for section headers
      if (trimmedLine.startsWith("[")) {
        inDependenciesSection = trimmedLine === "[tool.poetry.dependencies]";
        inGroupDependenciesSection = /^\[tool\.poetry\.group\..+\.dependencies\]$/.test(trimmedLine);
        continue;
      }

      // Only process lines in dependencies sections
      if (inDependenciesSection || inGroupDependenciesSection) {
        // Skip python version constraint
        if (trimmedLine.startsWith("python =")) {
          continue;
        }

        // Match simple dependency format: package = "version"
        const simpleMatch = trimmedLine.match(/^(\s*)([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"(.*)$/);
        if (simpleMatch) {
          const [, indent, packageName, currentVersion, rest] = simpleMatch;
          if (packageName.toLowerCase() === dependency.label.toLowerCase()) {
            // Preserve the version constraint style if possible
            const newVersion = preserveVersionConstraintStyle(currentVersion, dependency.latestVersion);
            lines[i] = `${indent}${packageName} = "${newVersion}"${rest}`;
            updated = true;
            break;
          }
          continue;
        }

        // Match complex dependency format: package = {version = "version", ...}
        const complexMatch = trimmedLine.match(/^(\s*)([a-zA-Z0-9_-]+)\s*=\s*\{(.+)\}(.*)$/);
        if (complexMatch) {
          const [, indent, packageName, tableContent, rest] = complexMatch;
          if (packageName.toLowerCase() === dependency.label.toLowerCase()) {
            // Update version within the table
            const updatedTableContent = tableContent.replace(
              /version\s*=\s*"([^"]+)"/,
              (match, currentVersion) => {
                const newVersion = preserveVersionConstraintStyle(currentVersion, dependency.latestVersion!);
                return `version = "${newVersion}"`;
              }
            );
            lines[i] = `${indent}${packageName} = {${updatedTableContent}}${rest}`;
            updated = true;
            break;
          }
          continue;
        }
      }
    }

    if (!updated) {
      vscode.window.showWarningMessage(
        `Package ${dependency.label} not found in ${vscode.workspace.asRelativePath(targetFile)}`
      );
      return false;
    }

    // Apply the changes
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(textContent.length)
    );
    edit.replace(targetFile, fullRange, lines.join("\n"));

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await document.save();
      vscode.window.showInformationMessage(
        `Updated ${dependency.label} to ${dependency.latestVersion} in ${vscode.workspace.asRelativePath(targetFile)}`
      );
      return true;
    } else {
      vscode.window.showErrorMessage(
        `Failed to update ${dependency.label} in ${vscode.workspace.asRelativePath(targetFile)}`
      );
      return false;
    }
  } catch (err: any) {
    console.error(`Error updating ${dependency.label}:`, err);
    vscode.window.showErrorMessage(
      `Error updating ${dependency.label}: ${err.message}`
    );
    return false;
  }
}

/**
 * Preserves the version constraint style when updating to a new version.
 * For example, if the current version is "^1.2.3", the new version will be "^2.0.0".
 *
 * @param currentVersion - The current version constraint
 * @param latestVersion - The latest available version
 * @returns The new version constraint preserving the original style
 */
function preserveVersionConstraintStyle(currentVersion: string, latestVersion: string): string {
  if (currentVersion.startsWith("^")) {
    return `^${latestVersion}`;
  } else if (currentVersion.startsWith("~")) {
    return `~${latestVersion}`;
  } else if (currentVersion.match(/^[<>=!]/)) {
    // For complex constraints, just use the exact version
    return latestVersion;
  } else {
    // Exact version, keep it exact
    return latestVersion;
  }
}

/**
 * Removes a Poetry package from pyproject.toml.
 *
 * @param dependency - The Poetry dependency to remove
 * @returns True if the removal was successful, false otherwise
 */
export async function removePoetryPackage(dependency: Dependency): Promise<boolean> {
  const pyprojectFiles = await vscode.workspace.findFiles(
    "**/pyproject.toml",
    getExcludePattern()
  );

  if (pyprojectFiles.length === 0) {
    vscode.window.showErrorMessage(
      "No pyproject.toml file found in the workspace"
    );
    return false;
  }

  let targetFile: vscode.Uri;

  if (pyprojectFiles.length > 1) {
    const items = pyprojectFiles.map((file) => ({
      label: vscode.workspace.asRelativePath(file),
      file,
    }));

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Select pyproject.toml file to remove package from",
    });

    if (!selection) {
      return false;
    }

    targetFile = selection.file;
  } else {
    targetFile = pyprojectFiles[0];
  }

  try {
    const document = await vscode.workspace.openTextDocument(targetFile);
    const textContent = document.getText();
    const lines = textContent.split(/\r?\n/);
    let removed = false;

    // Track if we're in a dependencies section
    let inDependenciesSection = false;
    let inGroupDependenciesSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check for section headers
      if (trimmedLine.startsWith("[")) {
        inDependenciesSection = trimmedLine === "[tool.poetry.dependencies]";
        inGroupDependenciesSection = /^\[tool\.poetry\.group\..+\.dependencies\]$/.test(trimmedLine);
        continue;
      }

      // Only process lines in dependencies sections
      if (inDependenciesSection || inGroupDependenciesSection) {
        // Match dependency lines
        const packageMatch = trimmedLine.match(/^([a-zA-Z0-9_-]+)\s*=/);
        if (packageMatch) {
          const packageName = packageMatch[1];
          if (packageName.toLowerCase() === dependency.label.toLowerCase()) {
            lines.splice(i, 1);
            removed = true;
            break;
          }
        }
      }
    }

    if (!removed) {
      vscode.window.showWarningMessage(
        `Package ${dependency.label} not found in ${vscode.workspace.asRelativePath(targetFile)}`
      );
      return false;
    }

    // Apply the changes
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(textContent.length)
    );
    edit.replace(targetFile, fullRange, lines.join("\n"));

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await document.save();
      vscode.window.showInformationMessage(
        `Removed ${dependency.label} from ${vscode.workspace.asRelativePath(targetFile)}`
      );
      return true;
    } else {
      vscode.window.showErrorMessage(
        `Failed to remove ${dependency.label} from ${vscode.workspace.asRelativePath(targetFile)}`
      );
      return false;
    }
  } catch (err: any) {
    console.error(`Error removing ${dependency.label}:`, err);
    vscode.window.showErrorMessage(
      `Error removing ${dependency.label}: ${err.message}`
    );
    return false;
  }
}