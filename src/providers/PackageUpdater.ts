/**
 * PackageUpdater - Handles package updates and removals
 */

import * as vscode from "vscode";
import * as path from "path";
import * as yaml from "js-yaml";
import { Dependency } from "../models/dependency";
import { updateNpmPackage } from "../updaters/npmUpdater";
import { updateComposerPackage } from "../updaters/composerUpdater";
import { updatePypiPackage } from "../updaters/pythonUpdater";
import { updatePubDevPackage } from "../updaters/dartUpdater";
import { updatePoetryPackage, removePoetryPackage } from "../updaters/poetryUpdater";
import { updateCargoPackage } from "../updaters/cargoUpdater";

export class PackageUpdater {
  async updatePackage(dependency: Dependency): Promise<boolean> {
    if (!dependency || !dependency.version || !dependency.latestVersion) {
      vscode.window.showErrorMessage("Cannot update package: Version information missing.");
      return false;
    }

    if (dependency.packageManager === "npm") {
      return await updateNpmPackage(dependency);
    } else if (dependency.packageManager === "composer") {
      return await updateComposerPackage(dependency);
    } else if (dependency.packageManager === "pip") {
      return await updatePypiPackage(dependency);
    } else if (dependency.packageManager === "poetry") {
      return await updatePoetryPackage(dependency);
    } else if (dependency.packageManager === "pub") {
      return await updatePubDevPackage(dependency);
    } else if (dependency.packageManager === "cargo") {
      return await updateCargoPackage(dependency);
    } else {
      vscode.window.showErrorMessage(
        `Updating ${dependency.packageManager} packages is not yet supported.`
      );
      return false;
    }
  }

  async removePackage(dependency: Dependency): Promise<boolean> {
    if (!dependency || !dependency.parentFile) {
      vscode.window.showErrorMessage("Cannot remove package: Parent file information missing.");
      return false;
    }

    try {
      const parentFilePath = dependency.parentFile;
      const packageName = dependency.label;
      const isDevDependency = dependency.isDevDependency || false;

      const fileUri = vscode.Uri.file(parentFilePath);
      const fileContent = await vscode.workspace.fs.readFile(fileUri);
      const fileText = Buffer.from(fileContent).toString("utf8");

      let updatedContent = fileText;

      if (dependency.packageManager === "npm") {
        updatedContent = this.removeFromNpmPackageJson(fileText, packageName, isDevDependency);
      } else if (dependency.packageManager === "composer") {
        updatedContent = this.removeFromComposerJson(fileText, packageName, isDevDependency);
      } else if (dependency.packageManager === "pip" && parentFilePath.endsWith("requirements.txt")) {
        updatedContent = this.removeFromRequirementsTxt(fileText, packageName);
      } else if (dependency.packageManager === "pub") {
        updatedContent = this.removeFromPubspecYaml(fileText, packageName, isDevDependency);
      } else if (dependency.packageManager === "poetry") {
        return await removePoetryPackage(dependency);
      } else {
        vscode.window.showErrorMessage(
          `Removing ${dependency.packageManager} packages is not yet supported.`
        );
        return false;
      }

      if (updatedContent === fileText) {
        vscode.window.showWarningMessage(`Package ${packageName} not found in ${parentFilePath}`);
        return false;
      }

      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, "utf8"));
      vscode.window.showInformationMessage(
        `Package ${packageName} has been removed from ${path.basename(parentFilePath)}`
      );

      return true;
    } catch (error) {
      console.error("Error removing package:", error);
      vscode.window.showErrorMessage(`Failed to remove package: ${error}`);
      return false;
    }
  }

  private removeFromNpmPackageJson(
    fileText: string,
    packageName: string,
    isDevDependency: boolean
  ): string {
    const packageJson = JSON.parse(fileText);

    if (isDevDependency && packageJson.devDependencies && packageJson.devDependencies[packageName]) {
      delete packageJson.devDependencies[packageName];
    } else if (!isDevDependency && packageJson.dependencies && packageJson.dependencies[packageName]) {
      delete packageJson.dependencies[packageName];
    } else {
      return fileText;
    }

    return JSON.stringify(packageJson, null, 2);
  }

  private removeFromComposerJson(
    fileText: string,
    packageName: string,
    isDevDependency: boolean
  ): string {
    const composerJson = JSON.parse(fileText);

    if (isDevDependency && composerJson["require-dev"] && composerJson["require-dev"][packageName]) {
      delete composerJson["require-dev"][packageName];
    } else if (!isDevDependency && composerJson.require && composerJson.require[packageName]) {
      delete composerJson.require[packageName];
    } else {
      return fileText;
    }

    return JSON.stringify(composerJson, null, 4);
  }

  private removeFromRequirementsTxt(fileText: string, packageName: string): string {
    const lines = fileText.split(/\r?\n/);
    const packagePattern = new RegExp(`^${packageName}[=~><].*$`, "i");
    const updatedLines = lines.filter((line) => !packagePattern.test(line.trim()));

    if (lines.length === updatedLines.length) {
      return fileText;
    }

    return updatedLines.join("\n");
  }

  private removeFromPubspecYaml(
    fileText: string,
    packageName: string,
    isDevDependency: boolean
  ): string {
    const pubspec: any = yaml.load(fileText);

    if (isDevDependency && pubspec.dev_dependencies && pubspec.dev_dependencies[packageName]) {
      delete pubspec.dev_dependencies[packageName];
    } else if (!isDevDependency && pubspec.dependencies && pubspec.dependencies[packageName]) {
      delete pubspec.dependencies[packageName];
    } else {
      return fileText;
    }

    return yaml.dump(pubspec, {
      lineWidth: -1,
      noRefs: true,
      indent: 2,
    });
  }
}
