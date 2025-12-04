/**
 * ManifestScanner - Scans workspace for package manifest files
 */

import * as vscode from "vscode";
import * as path from "path";
import { Dependency } from "../models/dependency";
import { getExcludePattern, isFileExcluded, pathExists } from "../utils/fileUtils";

export class ManifestScanner {
  constructor(private workspaceRoot: string | undefined) {}

  async findManifestFiles(): Promise<Dependency[]> {
    console.log(`[ManifestScanner] Starting manifest file scan...`);
    
    if (!this.workspaceRoot) {
      console.log(`[ManifestScanner] No workspace root found`);
      return [];
    }

    const patterns: string[] = [];
    const configuration = vscode.workspace.getConfiguration("pkgVersion");
    const scanVendorDirectory = configuration.get("scanVendorDirectory", true);
    const composerPackageDetection = configuration.get("composerPackageDetection", "auto");

    // Always include these patterns
    patterns.push("**/package.json");
    patterns.push("**/requirements.txt");
    patterns.push("**/pyproject.toml");
    patterns.push("**/Cargo.toml");
    patterns.push("**/pubspec.yaml");

    // Conditionally include composer patterns
    if (["auto", "composer.json", "all"].includes(composerPackageDetection)) {
      patterns.push("**/composer.json");
    }
    // Note: composer.lock is NOT included as a manifest file
    // It's used internally by vendor scanning but shouldn't be shown in the tree
    // as it contains ALL installed packages (including transitive dependencies)
    if (["auto", "vendor", "all"].includes(composerPackageDetection) && scanVendorDirectory) {
      patterns.push("**/vendor");
    }

    // Get exclude pattern
    const excludePattern = getExcludePattern();
    const excludePatterns = excludePattern.split(",").map(p => p.trim());
    console.log(`[ManifestScanner] Using ${excludePatterns.length} exclusion patterns`);

    console.log(`[ManifestScanner] Scanning for patterns: ${patterns.join(", ")}`);

    // Build critical excludes for VS Code's findFiles
    // Always exclude these massive directories
    const criticalExcludesList = [
      "**/node_modules/**",
      "**/venv/**",
      "**/.git/**",
      "**/build/**",
      "**/dist/**",
      "**/.next/**",
      "**/.nuxt/**",
      "**/bin/**",
      "**/__pycache__/**",
      "**/.dart_tool/**"
    ];

    // Handle vendor directory exclusion
    if (scanVendorDirectory && ["auto", "vendor", "all"].includes(composerPackageDetection)) {
      // When scanning vendor, we want to scan ONLY the top-level vendor directory
      // Exclude all nested vendor directories (vendor/**/composer.json, etc.)
      criticalExcludesList.push("**/vendor/*/**");
      console.log(`[ManifestScanner] Scanning vendor: excluding nested vendor files with **/vendor/*/**`);
    } else {
      // Not scanning vendor at all - exclude everything in vendor
      criticalExcludesList.push("**/vendor/**");
      console.log(`[ManifestScanner] Not scanning vendor: excluding all vendor files`);
    }

    const criticalExcludes = `{${criticalExcludesList.join(",")}}`;
    console.log(`[ManifestScanner] Using critical excludes: ${criticalExcludesList.length} patterns`);
    
    // Find files using VS Code's API with critical excludes
    const uris = await vscode.workspace.findFiles(
      `{${patterns.join(",")}}`,
      criticalExcludes
    );

    console.log(`[ManifestScanner] Found ${uris.length} files from VS Code API`);

    // Log first few files for debugging
    if (uris.length > 0) {
      const sampleSize = Math.min(5, uris.length);
      console.log(`[ManifestScanner] Sample files found:`);
      for (let i = 0; i < sampleSize; i++) {
        console.log(`  - ${uris[i].fsPath}`);
      }
      if (uris.length > sampleSize) {
        console.log(`  ... and ${uris.length - sampleSize} more`);
      }
    }

    // Apply additional custom exclusion logic for edge cases
    const filteredUris = uris.filter((uri) => {
      // Check if file is explicitly excluded by user patterns
      if (isFileExcluded(uri.fsPath)) {
        console.log(`[ManifestScanner] Excluded by custom pattern: ${uri.fsPath}`);
        return false;
      }
      return true;
    });

    console.log(`[ManifestScanner] After custom exclusion filtering: ${filteredUris.length} files`);

    // Convert URIs to Dependency objects (COLLAPSED state - no auto-expansion)
    const packageFiles = filteredUris.map((uri) => {
      const relativePath = vscode.workspace.asRelativePath(uri);
      return new Dependency(
        relativePath,
        "",
        vscode.TreeItemCollapsibleState.Collapsed, // IMPORTANT: Collapsed to prevent auto-loading
        uri
      );
    });

    console.log(`[ManifestScanner] Created ${packageFiles.length} manifest file entries`);

    // Auto-scan Composer projects if needed
    if (["auto", "all"].includes(composerPackageDetection) && this.workspaceRoot) {
      this.addMissingComposerFiles(packageFiles, composerPackageDetection, scanVendorDirectory);
    }

    console.log(`[ManifestScanner] Returning ${packageFiles.length} manifest files`);
    return packageFiles;
  }



  private addMissingComposerFiles(
    packageFiles: Dependency[],
    composerPackageDetection: string,
    scanVendorDirectory: boolean
  ): void {
    if (!this.workspaceRoot) return;

    const hasComposerJson = packageFiles.some((dep) =>
      dep.resourceUri?.fsPath.endsWith("composer.json")
    );

    // ONLY add composer.json if it's missing and detection mode allows it
    // composer.lock and vendor should NEVER be added as manifest files
    // They are used internally by the vendor scanner but shouldn't appear in the tree
    if (!hasComposerJson && ["auto", "composer.json", "all"].includes(composerPackageDetection)) {
      const rootComposerJsonPath = path.join(this.workspaceRoot, "composer.json");
      if (pathExists(rootComposerJsonPath)) {
        const rootComposerJsonUri = vscode.Uri.file(rootComposerJsonPath);
        const relativePath = vscode.workspace.asRelativePath(rootComposerJsonUri);
        packageFiles.push(
          new Dependency(
            relativePath,
            "",
            vscode.TreeItemCollapsibleState.Collapsed,
            rootComposerJsonUri
          )
        );
        console.log(`[ManifestScanner] Added missing composer.json from workspace root`);
      }
    }

    // NOTE: composer.lock and vendor are NOT added as manifest files
    // - composer.lock contains ALL packages (200+) including transitive dependencies
    // - vendor directory is scanned internally when needed
    // - These should never appear as separate tree items in the dependency view
  }
}
