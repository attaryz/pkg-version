import * as vscode from "vscode";
import { Dependency } from "./models/dependency";
import { DependencyProvider } from "./dependencyProvider";
import { getVulnerabilityCache } from "./utils/vulnerabilityCache";
import { resolveInstalledVersion, cleanVersionSpecifier } from "./utils/installedVersion";
import { getEnabledProvidersSignature } from "./utils/vulnerabilityProviderManager";

export class SecurityReportProvider implements vscode.TreeDataProvider<Dependency> {
  private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<Dependency | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private dependencyProvider: DependencyProvider) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Dependency): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Dependency): Promise<Dependency[]> {
    if (element && element.children) {
      return element.children;
    }

    // Build a list of vulnerable dependencies from cache for the current provider selection
    const providerKey = getEnabledProvidersSignature();
    const allDeps = await this.dependencyProvider.getAllDependencies();
    const packageDeps = allDeps.filter(d => d.label && d.packageManager && !d.children);

    const vulnerable: Dependency[] = [];

    for (const dep of packageDeps) {
      try {
        const effectiveVersion = (await resolveInstalledVersion(dep)) || cleanVersionSpecifier(dep.version) || dep.version || "";
        const cached = getVulnerabilityCache().get(dep.label, effectiveVersion, dep.packageManager!, providerKey);
        if (Array.isArray(cached) && cached.length > 0) {
          dep.vulnerabilities = cached;
          // Set command so double-click opens the package details
          dep.command = {
            command: "pkg-version.viewPackageInfo",
            title: "View Package Info",
            arguments: [dep]
          };
          vulnerable.push(dep);
        }
      } catch {
        // ignore and continue
      }
    }

    if (vulnerable.length === 0) {
      const empty = new Dependency(
        "No scan results yet. Run 'Check for Security Vulnerabilities'",
        "",
        vscode.TreeItemCollapsibleState.None
      );
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }

    // Group by highest severity
    const groups: Record<string, Dependency[]> = { critical: [], high: [], medium: [], low: [] };
    for (const d of vulnerable) {
      const sev = this.getHighestSeverity(d) as keyof typeof groups;
      (groups[sev] || groups.low).push(d);
    }

    const makeCategory = (label: string, items: Dependency[]): Dependency | undefined => {
      if (items.length === 0) return undefined;
      const cat = new Dependency(label, "", vscode.TreeItemCollapsibleState.Expanded);
      cat.iconPath = new vscode.ThemeIcon("shield");
      cat.children = items;
      return cat;
    };

    const cats = [
      makeCategory("Critical", groups.critical),
      makeCategory("High", groups.high),
      makeCategory("Medium", groups.medium),
      makeCategory("Low", groups.low)
    ].filter((x): x is Dependency => Boolean(x));

    return cats.length > 0 ? cats : vulnerable;
  }

  private getHighestSeverity(dep: Dependency): string {
    if (!dep.vulnerabilities || dep.vulnerabilities.length === 0) return "low";
    const order = ["critical", "high", "medium", "low"];
    let best = "low";
    for (const v of dep.vulnerabilities) {
      if (order.indexOf(v.severity) < order.indexOf(best)) {
        best = v.severity;
      }
    }
    return best;
  }
}
