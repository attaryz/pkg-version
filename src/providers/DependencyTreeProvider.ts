/**
 * DependencyTreeProvider - Core TreeView provider for package dependencies
 * Handles the tree structure and data management
 */

import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { ManifestScanner } from "./ManifestScanner";
import { DependencyLoader } from "./DependencyLoader";
import { PackageUpdater } from "./PackageUpdater";
import { PackageInfoViewer } from "./PackageInfoViewer";

export class DependencyTreeProvider implements vscode.TreeDataProvider<Dependency> {
  private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined | null | void> = 
    new vscode.EventEmitter<Dependency | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<Dependency | undefined | null | void> = 
    this._onDidChangeTreeData.event;

  private manifestScanner: ManifestScanner;
  private dependencyLoader: DependencyLoader;
  private packageUpdater: PackageUpdater;
  private packageInfoViewer: PackageInfoViewer;
  
  // Cache for manifest files to prevent repeated scans
  private _manifestFilesCache: Dependency[] | undefined;
  private _isScanning: boolean = false;

  constructor(private workspaceRoot: string | undefined) {
    this.manifestScanner = new ManifestScanner(workspaceRoot);
    this.dependencyLoader = new DependencyLoader(this._onDidChangeTreeData);
    this.packageUpdater = new PackageUpdater();
    this.packageInfoViewer = new PackageInfoViewer();
  }

  getTreeItem(element: Dependency): vscode.TreeItem {
    // Apply special styling to category nodes
    if (element.children) {
      if (!element.iconPath) {
        element.iconPath = new vscode.ThemeIcon(
          "folder",
          new vscode.ThemeColor("charts.blue")
        );
      }
      element.description = `(${element.children.length})`;
      return element;
    }

    // For dependency items, dynamically update icon and description based on current state
    // This ensures that when versions are loaded in background, the UI updates correctly
    const isManifestNode = !element.version;
    
    if (!isManifestNode && element.latestVersion && element.updateType && element.updateType !== "none") {
      // Update tooltip
      element.tooltip = `${element.label}: ${element.version} → ${element.latestVersion} (${element.updateType} update)${element.isDevDependency ? ' [dev]' : ''}`;
      
      // Update icon and description based on update type
      if (element.updateType === "major") {
        element.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("errorForeground")
        );
        element.description = `🔴 ${element.version} → ${element.latestVersion}${element.isDevDependency ? ' [dev]' : ''}`;
      } else if (element.updateType === "minor") {
        element.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("editorWarning.foreground")
        );
        element.description = `🟠 ${element.version} → ${element.latestVersion}${element.isDevDependency ? ' [dev]' : ''}`;
      } else if (element.updateType === "patch") {
        element.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("editorInfo.foreground")
        );
        element.description = `🟡 ${element.version} → ${element.latestVersion}${element.isDevDependency ? ' [dev]' : ''}`;
      }
      
      element.contextValue = "dependency";
    } else if (!isManifestNode && !element.latestVersion) {
      // Still loading version info - show loading indicator
      element.description = `${element.version}${element.isDevDependency ? ' [dev]' : ''} (checking...)`;
      element.iconPath = new vscode.ThemeIcon("sync~spin");
    } else if (!isManifestNode) {
      // Up to date
      element.iconPath = new vscode.ThemeIcon(
        "pass-filled",
        new vscode.ThemeColor("charts.green")
      );
      element.description = `${element.version}${element.isDevDependency ? ' [dev]' : ''}`;
    }
    
    return element;
  }

  async getChildren(element?: Dependency): Promise<Dependency[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage("No workspace open");
      return [];
    }

    // If element is a category node, return its children
    if (element && element.children) {
      return element.children;
    }

    // If element is a manifest file, load its dependencies
    if (element && element.resourceUri) {
      return this.dependencyLoader.loadDependenciesForManifest(element);
    }

    // Root level - return manifest files (with caching to prevent repeated scans)
    if (this._manifestFilesCache) {
      console.log(`[TreeProvider] Returning cached manifest files (${this._manifestFilesCache.length})`);
      return this._manifestFilesCache;
    }

    // Prevent concurrent scans
    if (this._isScanning) {
      console.log(`[TreeProvider] Scan already in progress, returning empty array`);
      return [];
    }

    try {
      this._isScanning = true;
      console.log(`[TreeProvider] Starting manifest file scan...`);
      this._manifestFilesCache = await this.manifestScanner.findManifestFiles();
      console.log(`[TreeProvider] Cached ${this._manifestFilesCache.length} manifest files`);
      return this._manifestFilesCache;
    } finally {
      this._isScanning = false;
    }
  }

  refresh(): void {
    console.log("[TreeProvider] Refreshing tree...");
    
    // Clear all caches for fresh data
    this.dependencyLoader.clearCache();
    this._manifestFilesCache = undefined; // Clear manifest cache
    this._isScanning = false; // Reset scanning flag
    
    // Clear version cache to get fresh version data
    const { clearUpdateCache } = require("../utils/updateCache");
    clearUpdateCache();
    console.log("[TreeProvider] Cleared version cache");
    
    this._onDidChangeTreeData.fire();
    console.log("[TreeProvider] Tree refreshed");
  }

  async updatePackage(dependency: Dependency): Promise<boolean> {
    const result = await this.packageUpdater.updatePackage(dependency);
    if (result) {
      this.refresh();
    }
    return result;
  }

  async removePackage(dependency: Dependency): Promise<boolean> {
    const result = await this.packageUpdater.removePackage(dependency);
    if (result) {
      this.refresh();
    }
    return result;
  }

  async viewPackageInfo(dependency: Dependency): Promise<void> {
    return this.packageInfoViewer.showPackageInfo(dependency);
  }

  async getAllOutdatedDependencies(): Promise<Dependency[]> {
    return this.dependencyLoader.getAllOutdatedDependencies();
  }

  async getAllDependencies(): Promise<Dependency[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    const allDependencies: Dependency[] = [];
    const packageFiles = await this.getChildren();

    for (const packageFile of packageFiles) {
      allDependencies.push(packageFile);

      if (packageFile.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed ||
        packageFile.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
        const dependencies = await this.getChildren(packageFile);
        allDependencies.push(...dependencies);

        for (const dependency of dependencies) {
          if (dependency.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed ||
            dependency.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
            const nestedDependencies = await this.getChildren(dependency);
            allDependencies.push(...nestedDependencies);
          }
        }
      }
    }

    return allDependencies;
  }
}
