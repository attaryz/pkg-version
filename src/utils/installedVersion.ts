import * as vscode from "vscode";
import * as path from "path";

// Simple semver-like cleanup for common specifiers
export function cleanVersionSpecifier(spec?: string): string | undefined {
  if (!spec) return undefined;
  const s = spec.trim();
  // Exact version like 1.2.3 or 1.2.3-beta
  if (/^\d+\.\d+\.\d+([.-][0-9A-Za-z]+)?$/.test(s)) return s;
  // Remove leading ^ ~ =
  const stripped = s.replace(/^[~^=]+/, "").trim();
  if (/^\d+\.\d+\.\d+([.-][0-9A-Za-z]+)?$/.test(stripped)) return stripped;
  // >=1.2.3, <=, >, < patterns -> take the numeric version portion as a fallback
  const m = stripped.match(/(\d+\.\d+\.\d+(?:[.-][0-9A-Za-z]+)?)/);
  if (m) return m[1];
  return undefined;
}

export async function resolveInstalledVersion(dep: {
  label: string;
  version?: string;
  packageManager?: string;
  parentFile?: string;
}): Promise<string | undefined> {
  const pkgManager = (dep.packageManager || "").toLowerCase();
  const manifestDir = dep.parentFile ? path.dirname(dep.parentFile) : undefined;

  try {
    if (pkgManager === "npm" || pkgManager === "yarn" || pkgManager === "pnpm") {
      if (manifestDir) {
        const v = await resolveNpmInstalledVersion(manifestDir, dep.label);
        if (v) return v;
      }
      return cleanVersionSpecifier(dep.version);
    }

    if (pkgManager === "composer") {
      if (manifestDir) {
        const v = await resolveComposerInstalledVersion(manifestDir, dep.label);
        if (v) return v;
      }
      return cleanVersionSpecifier(dep.version);
    }

    // Other ecosystems: best-effort cleanup
    return cleanVersionSpecifier(dep.version);
  } catch {
    // Failed to resolve installed version
    return cleanVersionSpecifier(dep.version);
  }
}

async function readJsonFile<T = any>(uri: vscode.Uri): Promise<T | undefined> {
  try {
    const buf = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch {
    return undefined;
  }
}

export async function resolveNpmInstalledVersion(rootDir: string, packageName: string): Promise<string | undefined> {
  // 1) Try node_modules first (works for classic node_modules layouts)
  const nodeModulesDir = path.join(rootDir, "node_modules");
  const pkgPath = packageName.startsWith("@")
    ? path.join(nodeModulesDir, ...packageName.split("/"), "package.json")
    : path.join(nodeModulesDir, packageName, "package.json");

  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(pkgPath));
    if (stat) {
      const json = await readJsonFile<any>(vscode.Uri.file(pkgPath));
      if (json?.version) return String(json.version);
    }
  } catch {}

  // 2) Try package-lock.json v2+ (packages map)
  const lockUri = vscode.Uri.file(path.join(rootDir, "package-lock.json"));
  const lock = await readJsonFile<any>(lockUri);
  if (lock) {
    // v2 format
    if (lock.packages) {
      const key = packageName.startsWith("@") ? `node_modules/${packageName}` : `node_modules/${packageName}`;
      const entry = lock.packages[key];
      if (entry?.version) return String(entry.version);
    }
    // v1 format (recursive dependencies tree)
    if (lock.dependencies) {
      const v = lookupNpmLockV1(lock.dependencies, packageName);
      if (v) return v;
    }
  }

  // 3) Climb one directory up (monorepo workspaces)
  const parent = path.dirname(rootDir);
  if (parent && parent !== rootDir) {
    try {
      const v = await resolveNpmInstalledVersion(parent, packageName);
      if (v) return v;
    } catch {}
  }

  return undefined;
}

function lookupNpmLockV1(tree: any, name: string): string | undefined {
  if (!tree) return undefined;
  const dep = tree[name];
  if (dep?.version) return String(dep.version);
  for (const key of Object.keys(tree)) {
    const child = tree[key];
    if (child?.dependencies) {
      const v = lookupNpmLockV1(child.dependencies, name);
      if (v) return v;
    }
  }
  return undefined;
}

export async function resolveComposerInstalledVersion(rootDir: string, packageName: string): Promise<string | undefined> {
  // 1) Try composer.lock
  const lockUri = vscode.Uri.file(path.join(rootDir, "composer.lock"));
  const lock = await readJsonFile<any>(lockUri);
  if (lock) {
    const scan = (arr?: any[]) => {
      if (!Array.isArray(arr)) return undefined;
      const found = arr.find(p => p?.name === packageName);
      return found?.version ? String(found.version) : undefined;
    };
    const v = scan(lock.packages) || scan(lock["packages-dev"]);
    if (v) return v;
  }

  // 2) Try vendor directory
  const vendorPath = path.join(rootDir, "vendor", ...packageName.split("/"), "composer.json");
  try {
    const json = await readJsonFile<any>(vscode.Uri.file(vendorPath));
    if (json?.version) return String(json.version);
  } catch {}

  // 3) Climb up
  const parent = path.dirname(rootDir);
  if (parent && parent !== rootDir) {
    try {
      const v = await resolveComposerInstalledVersion(parent, packageName);
      if (v) return v;
    } catch {}
  }
  return undefined;
}
