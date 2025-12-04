import * as vscode from "vscode";
import { Vulnerability } from "../utils/vulnerabilityProvider";

/**
 * Represents a dependency item in the tree view.
 * Can be either a package file (root item) or an individual dependency.
 *
 * Package files:
 * - Have a resourceUri pointing to the file
 * - Have children (dependencies)
 * - Have a contextValue of "packageFile"
 * - Have an open command
 *
 * Individual dependencies:
 * - Have version information
 * - Have update status
 * - Have icons based on update type
 * - Have a contextValue of "dependency"
 */
export class Dependency extends vscode.TreeItem {
  public latestVersion?: string; // Store the latest fetched version
  public updateType?: "major" | "minor" | "patch" | "prerelease" | "none"; // Store the type of update
  public packageManager?: string; // Store the package manager type
  public parentFile?: string; // Store the parent file path
  public isDevDependency?: boolean; // Indicate if this is a dev dependency
  public children?: Dependency[]; // Store child dependencies for category nodes
  public vulnerabilities?: Vulnerability[]; // Store security vulnerabilities
  public runtime?: string; // The runtime version info (e.g. Node 18)
  public language?: string; // Primary language of the project
  public deprecated?: boolean; // Indicate if this package is deprecated

  /**
   * Creates a new Dependency tree item.
   *
   * @param label - Display name (filename or package name)
   * @param version - Version string or constraint
   * @param collapsibleState - Whether the item can be expanded
   * @param resourceUri - For package files, the URI to the file
   * @param latestVersion - Optional latest available version
   * @param updateType - Optional update type classification
   * @param packageManager - Optional package manager type
   * @param parentFile - Optional parent file path
   * @param isDevDependency - Optional flag indicating if this is a dev dependency
   * @param vulnerabilities - Optional array of security vulnerabilities
   * @param deprecated - Optional flag indicating if this package is deprecated
   */
  constructor(
    public readonly label: string, // Filename or package name
    public readonly version: string, // Version or empty string for file
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceUri?: vscode.Uri, // Store Uri for files
    latestVersion?: string, // Add latestVersion parameter
    updateType?: "major" | "minor" | "patch" | "prerelease" | "none", // Add updateType parameter
    packageManager?: string, // Add package manager parameter
    parentFile?: string, // Add parent file path parameter
    isDevDependency?: boolean, // Add isDevDependency parameter
    vulnerabilities?: Vulnerability[], // Add vulnerabilities parameter
    deprecated?: boolean // Add deprecated parameter
  ) {
    super(label, collapsibleState);
    this.latestVersion = latestVersion;
    this.updateType = updateType;
    this.packageManager = packageManager;
    this.parentFile = parentFile;
    this.isDevDependency = isDevDependency;
    this.vulnerabilities = vulnerabilities;
    this.deprecated = deprecated;

    const isManifestNode = !version; // Empty string means manifest file

    // If this item represents a manifest/package file, attempt to enrich with info
    if (isManifestNode && this.resourceUri) {
      try {
        const { getPackageInfo } = require("../utils/packageInfo") as typeof import("../utils/packageInfo");
        const info = getPackageInfo(this.resourceUri.fsPath);
        if (info) {
          this.packageManager = info.packageManager;
          this.language = info.language;
          this.runtime = info.runtime;

          // Just set a simple tooltip for manifest files
          this.tooltip = this.label;
          
          // Explicitly ensure no description is set
          this.description = "";
        }
      } catch (err) {
        console.error("Failed to get package info for", this.resourceUri.fsPath, err);
      }
      
      // Set contextValue for manifest files to enable context menu
      this.contextValue = "manifestFile";
    }

    // For manifest nodes we skip the update tooltip logic below
    if (!isManifestNode && latestVersion && updateType && updateType !== "none") {
      this.tooltip = `${this.label}: ${version} → ${latestVersion} (${updateType} update)${isDevDependency ? ' [dev]' : ''}`;
      // Description is now set in the icon/indicator section
    } else if (!isManifestNode) {
      this.tooltip = `${this.label}${version ? `: ${version}` : ""}${isDevDependency ? ' [dev]' : ''}`;
      // Description is now set in the icon/indicator section
    }

    // Add vulnerability information to tooltip if available
    if (!isManifestNode && vulnerabilities && vulnerabilities.length > 0) {
      // Filter vulnerabilities by severity
      const filteredVulns = this.filterVulnerabilitiesBySeverity(vulnerabilities);
      const vulnCount = filteredVulns.length;
      
      if (vulnCount > 0) {
        const highestSeverity = this.getHighestSeverity(filteredVulns);
        this.tooltip += `\n\n⚠️ ${vulnCount} ${vulnCount === 1 ? 'vulnerability' : 'vulnerabilities'} found (${highestSeverity} severity)`;
        
        // Add first 3 vulnerabilities to tooltip
        const maxVulnsToShow = Math.min(3, vulnCount);
        for (let i = 0; i < maxVulnsToShow; i++) {
          const v = filteredVulns[i];
          this.tooltip += `\n- ${v.title} (${v.severity})`;
        }
        
        if (vulnCount > maxVulnsToShow) {
          this.tooltip += `\n- ... and ${vulnCount - maxVulnsToShow} more`;
        }
      }
    }

    // Set contextValue based on whether this is a package with an update available
    if (!isManifestNode && updateType && updateType !== "none" && latestVersion) {
      this.contextValue = "dependency";
    } else if (!isManifestNode) {
      // Even if there's no update, we want to enable the context menu for all packages
      this.contextValue = "package-dependency";
    }

    // Set icon based on updateType and vulnerabilities
    if (!isManifestNode && vulnerabilities && vulnerabilities.length > 0) {
      // Vulnerability indicators take precedence over update indicators
      const severity = this.getHighestSeverity(vulnerabilities);
      
      if (severity === "critical" || severity === "high") {
        this.iconPath = new vscode.ThemeIcon(
          "shield",
          new vscode.ThemeColor("errorForeground")
        );
        this.description = `⚠️ ${version}${isDevDependency ? ' [dev]' : ''} (${vulnerabilities.length} vulnerabilities)`;
        this.contextValue = "vulnerable-dependency";
      } else {
        this.iconPath = new vscode.ThemeIcon(
          "shield",
          new vscode.ThemeColor("editorWarning.foreground")
        );
        this.description = `⚠️ ${version}${isDevDependency ? ' [dev]' : ''} (${vulnerabilities.length} vulnerabilities)`;
        this.contextValue = "vulnerable-dependency";
      }
    } else if (!isManifestNode && this.deprecated) {
      // Deprecated packages get special styling - crossed out appearance
      this.iconPath = new vscode.ThemeIcon(
        "trash",
        new vscode.ThemeColor("errorForeground")
      );
      // Use strikethrough formatting for deprecated packages
      this.label = `~~${label}~~`;
      this.description = `🚫 DEPRECATED ${version}${isDevDependency ? ' [dev]' : ''}`;
      this.tooltip = `${label}: ${version} (DEPRECATED PACKAGE)${isDevDependency ? ' [dev]' : ''}`;
      this.contextValue = "deprecated-dependency";
    } else if (!isManifestNode && this.updateType && this.updateType !== "none") {
      // Use consistent emoji indicators for update types
      if (this.updateType === "major") {
        this.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("errorForeground")
        );
        this.description = `🔴 ${version} → ${latestVersion}${isDevDependency ? ' [dev]' : ''}`;
      } else if (this.updateType === "minor") {
        this.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("editorWarning.foreground")
        );
        this.description = `🟠 ${version} → ${latestVersion}${isDevDependency ? ' [dev]' : ''}`;
      } else if (this.updateType === "patch") {
        this.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("editorInfo.foreground")
        );
        this.description = `🟡 ${version} → ${latestVersion}${isDevDependency ? ' [dev]' : ''}`;
      } else {
        this.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("focusBorder")
        );
        this.description = `🔵 ${version} → ${latestVersion}${isDevDependency ? ' [dev]' : ''}`;
      }
    } else if (!isManifestNode) {
      this.iconPath = new vscode.ThemeIcon(
        "pass-filled",
        new vscode.ThemeColor("charts.green")
      );
      this.description = `${version}${isDevDependency ? ' [dev]' : ''}`;
    }

    // Set command for opening the file
    if (this.resourceUri) {
      this.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [this.resourceUri],
      };
    }
  }
  
  /**
   * Filter vulnerabilities based on severity settings
   */
  private filterVulnerabilitiesBySeverity(vulnerabilities: Vulnerability[]): Vulnerability[] {
    const config = vscode.workspace.getConfiguration("pkgVersion");
    const hideBelow = config.get<string>("hideVulnerabilitiesBelow") || "none";
    
    if (hideBelow === "none") {
      return vulnerabilities;
    }
    
    const severityOrder = ["low", "medium", "high", "critical"];
    const minSeverityIndex = severityOrder.indexOf(hideBelow);
    
    return vulnerabilities.filter(vuln => {
      const vulnIndex = severityOrder.indexOf(vuln.severity);
      return vulnIndex >= minSeverityIndex;
    });
  }

  /**
   * Gets the highest severity level from a list of vulnerabilities
   * @param vulnerabilities The list of vulnerabilities to check
   * @returns The highest severity level found
   */
  private getHighestSeverity(vulnerabilities: Vulnerability[]): string {
    const severityOrder = ["critical", "high", "medium", "low"];
    let highestIndex = severityOrder.length; // Default to lowest severity
    
    for (const vuln of vulnerabilities) {
      const index = severityOrder.indexOf(vuln.severity);
      if (index >= 0 && index < highestIndex) {
        highestIndex = index;
      }
    }
    
    return highestIndex < severityOrder.length ? severityOrder[highestIndex] : "low";
  }
}