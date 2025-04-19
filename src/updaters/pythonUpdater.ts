import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { getExcludePattern } from "../utils/fileUtils";

/**
 * Updates a Python package in requirements.txt.
 *
 * @param dependency - The Python dependency to update
 * @returns True if the update was successful, false otherwise
 */
export async function updatePypiPackage(dependency: Dependency): Promise<boolean> {
  if (!dependency.latestVersion) {
    vscode.window.showErrorMessage(
      "Cannot update this package: missing latest version information"
    );
    return false;
  }

  const requirementsFiles = await vscode.workspace.findFiles(
    "**/requirements.txt",
    getExcludePattern()
  );

  if (requirementsFiles.length === 0) {
    vscode.window.showErrorMessage(
      "No requirements.txt file found in the workspace"
    );
    return false;
  }

  let targetFile: vscode.Uri;

  if (requirementsFiles.length > 1) {
    // If multiple requirements.txt files, let user choose which one to update
    const items = requirementsFiles.map((file) => ({
      label: vscode.workspace.asRelativePath(file),
      file,
    }));

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Select requirements.txt file to update",
    });

    if (!selection) {
      return false;
    }

    targetFile = selection.file;
  } else {
    // Only one requirements.txt, use it
    targetFile = requirementsFiles[0];
  }

  try {
    const document = await vscode.workspace.openTextDocument(targetFile);
    const textContent = document.getText();
    const lines = textContent.split(/\r?\n/);
    let updated = false;

    // Regex to match package specifications with versions
    const packageRegex = new RegExp(
      `^\\s*(${dependency.label})\\s*([<>=!~^].*)?$`,
      "i"
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = packageRegex.exec(line);

      if (match) {
        // Keep any comparison operators (==, >=, etc.)
        const operator = line.includes("==")
          ? "=="
          : line.includes(">=")
          ? ">="
          : line.includes(">")
          ? ">"
          : line.includes("<=")
          ? "<="
          : line.includes("<")
          ? "<"
          : line.includes("~=")
          ? "~="
          : "==";

        lines[
          i
        ] = `${dependency.label}${operator}${dependency.latestVersion}`;
        updated = true;
        break;
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

    // Write the updated requirements.txt back to disk
    const edit = new vscode.WorkspaceEdit();
    const entireRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    edit.replace(targetFile, entireRange, lines.join("\n"));

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
    console.error("Error updating requirements.txt:", error);
    vscode.window.showErrorMessage(
      `Error updating requirements.txt: ${error.message}`
    );
    return false;
  }
} 