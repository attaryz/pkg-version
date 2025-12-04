/**
 * PackageInfoViewer - Displays detailed package information in a webview
 * Note: This is a placeholder - the full implementation from dependencyProvider.ts
 * should be moved here
 */

import * as vscode from "vscode";
import { Dependency } from "../models/dependency";

export class PackageInfoViewer {
  async showPackageInfo(dependency: Dependency): Promise<void> {
    if (!dependency) {
      vscode.window.showErrorMessage("Cannot view package info: Package information missing.");
      return;
    }

    // TODO: Move the full viewPackageInfo implementation here
    // For now, show a simple message
    vscode.window.showInformationMessage(
      `Package Info: ${dependency.label} v${dependency.version}`
    );
  }
}
