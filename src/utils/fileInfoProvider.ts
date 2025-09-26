import * as vscode from "vscode";
import * as path from "path";
import { getPackageInfo } from "./packageInfo";

/**
 * Tree item for file information display
 */
class FileInfoItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description?: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly children?: FileInfoItem[]
  ) {
    super(label, collapsibleState);
    
    // Set icon based on item type
    if (children) {
      this.iconPath = new vscode.ThemeIcon("folder");
    } else {
      this.iconPath = new vscode.ThemeIcon("info");
    }
  }
}

/**
 * Provider for showing runtime, language and package manager information for the selected file
 */
export class FileInfoProvider implements vscode.TreeDataProvider<FileInfoItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FileInfoItem | undefined | null | void> = 
    new vscode.EventEmitter<FileInfoItem | undefined | null | void>();
  
  readonly onDidChangeTreeData: vscode.Event<FileInfoItem | undefined | null | void> = 
    this._onDidChangeTreeData.event;

  private _selectedFile: string | undefined;

  constructor() {
    // Listen for changes in editor selection
    vscode.window.onDidChangeActiveTextEditor(() => {
      this.refresh();
    });
  }

  /**
   * Gets the currently selected file path
   */
  private getSelectedFilePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      return editor.document.uri.fsPath;
    }
    return undefined;
  }

  /**
   * Refreshes the tree view
   */
  public refresh(): void {
    this._selectedFile = this.getSelectedFilePath();
    this._onDidChangeTreeData.fire();
  }

  /**
   * Gets the tree item for display in the view
   */
  getTreeItem(element: FileInfoItem): vscode.TreeItem {
    return element;
  }

  /**
   * Gets child items for the tree view
   */
  async getChildren(element?: FileInfoItem): Promise<FileInfoItem[]> {
    if (element) {
      return element.children || [];
    }

    // No active editor or file
    if (!this._selectedFile) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [new FileInfoItem("No file selected")];
      }
      this._selectedFile = editor.document.uri.fsPath;
    }

    // Get file information
    const fileName = path.basename(this._selectedFile);
    
    // Try to get package info for the file
    const packageInfo = getPackageInfo(this._selectedFile);
    
    if (!packageInfo) {
      // No package info available - show basic file info
      const langId = this.getLanguageId(this._selectedFile);
      return [
        new FileInfoItem("File", fileName),
        new FileInfoItem("Type", path.extname(this._selectedFile) || "No extension"),
        new FileInfoItem("Language", langId || "Unknown")
      ];
    }

    // Create root category
    const fileItem = new FileInfoItem(
      "File Information",
      fileName,
      vscode.TreeItemCollapsibleState.Expanded
    );

    // Create environment category
    const envItem = new FileInfoItem(
      "Environment",
      "",
      vscode.TreeItemCollapsibleState.Expanded,
      [
        new FileInfoItem("Runtime", packageInfo.runtime),
        new FileInfoItem("Language", packageInfo.language),
        new FileInfoItem("Package Manager", packageInfo.packageManager + 
          (packageInfo.packageManagerVersion ? ` v${packageInfo.packageManagerVersion}` : ""))
      ]
    );

    return [fileItem, envItem];
  }

  /**
   * Gets the language ID for a file from VSCode
   */
  private getLanguageId(filePath: string): string | undefined {
    // Try to get language ID from active editor
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.fsPath === filePath) {
      return editor.document.languageId;
    }

    // Fallback to extension mapping
    const extension = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'javascriptreact',
      '.tsx': 'typescriptreact',
      '.php': 'php',
      '.py': 'python',
      '.dart': 'dart',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cs': 'csharp',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.sh': 'shellscript',
      '.ps1': 'powershell'
    };
    
    return langMap[extension] || undefined;
  }
} 