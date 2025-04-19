import * as vscode from "vscode";

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
   */
  constructor(
    public readonly label: string, // Filename or package name
    private version: string, // Version or empty string for file
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceUri?: vscode.Uri, // Store Uri for files
    latestVersion?: string, // Add latestVersion parameter
    updateType?: "major" | "minor" | "patch" | "prerelease" | "none", // Add updateType parameter
    packageManager?: string, // Add package manager parameter
    parentFile?: string, // Add parent file path parameter
    isDevDependency?: boolean // Add isDevDependency parameter
  ) {
    super(label, collapsibleState);
    this.latestVersion = latestVersion;
    this.updateType = updateType;
    this.packageManager = packageManager;
    this.parentFile = parentFile;
    this.isDevDependency = isDevDependency;

    // Update tooltip and description to show both current and latest version
    if (latestVersion && updateType && updateType !== "none") {
      this.tooltip = `${this.label}: ${version} → ${latestVersion} (${updateType} update)${isDevDependency ? ' [dev]' : ''}`;
      // Description is now set in the icon/indicator section
    } else {
      this.tooltip = `${this.label}${version ? `: ${version}` : ""}${isDevDependency ? ' [dev]' : ''}`;
      // Description is now set in the icon/indicator section
    }

    // Set contextValue based on whether this is a package with an update available
    if (updateType && updateType !== "none" && latestVersion) {
      this.contextValue = "dependency";
    }

    // Set icon based on updateType using consistent emoji indicators matching documentation
    if (this.updateType && this.updateType !== "none") {
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
    } else {
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
} 