import * as vscode from "vscode";
import { Dependency } from "../models/dependency";
import { fetchLatestCratesVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a Cargo.toml file and extracts dependencies and dev-dependencies.
 * Creates dependency objects WITHOUT fetching latest versions for faster initial load.
 * Versions will be fetched in the background by the DependencyProvider.
 *
 * Limitations: multi-line tables for dependencies are skipped for now.
 */
export async function getDepsInCargoToml(
  cargoTomlUri: vscode.Uri
): Promise<Dependency[]> {
  if (!pathExists(cargoTomlUri.fsPath)) {
    return Promise.resolve([]);
  }

  try {
    const buffer = await vscode.workspace.fs.readFile(cargoTomlUri);
    const content = Buffer.from(buffer).toString("utf8");

    const { deps, devDeps } = parseCargoDependencies(content);

    const dependencies: Dependency[] = [];

    const pushDep = (name: string, versionSpec: string, isDev: boolean) => {
      // Create dependency without fetching version (will be loaded in background)
      dependencies.push(new Dependency(
        name,
        versionSpec,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined, // latestVersion - will be loaded in background
        "none", // updateType - will be determined when version is loaded
        "cargo",
        cargoTomlUri.fsPath,
        isDev
      ));
    };

    for (const [name, version] of Object.entries(deps)) {
      pushDep(name, version, false);
    }
    for (const [name, version] of Object.entries(devDeps)) {
      pushDep(name, version, true);
    }

    return dependencies;
  } catch (err) {
    console.error(`Error reading or parsing ${cargoTomlUri.fsPath}:`, err);
    vscode.window.showErrorMessage(
      `Failed to read dependencies from ${vscode.workspace.asRelativePath(cargoTomlUri)}`
    );
    return [];
  }
}

/**
 * Very small TOML extractor tailored to Cargo.toml deps.
 */
function parseCargoDependencies(content: string): {
  deps: Record<string, string>;
  devDeps: Record<string, string>;
} {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};

  const lines = content.split(/\r?\n/);
  let section: "none" | "deps" | "dev" = "none";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[")) {
      if (line === "[dependencies]") section = "deps";
      else if (line === "[dev-dependencies]") section = "dev";
      else section = "none";
      continue;
    }

    if (section === "none") continue;

    // simple: name = "1.2.3" or name = "^1.2"
    let m = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*"([^"]+)"/);
    if (m) {
      const [, name, versionSpec] = m;
      if (section === "deps") deps[name] = versionSpec;
      else devDeps[name] = versionSpec;
      continue;
    }

    // inline table: name = { version = "1.2.3", ... }
    m = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*\{([^}]*)\}/);
    if (m) {
      const [, name, table] = m;
      const v = table.match(/version\s*=\s*"([^"]+)"/);
      if (v) {
        if (section === "deps") deps[name] = v[1];
        else devDeps[name] = v[1];
      }
      continue;
    }

    // start of multi-line table: name = {
    // We skip until closing brace '}' for simplicity
    m = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*\{$/);
    if (m) {
      // scan ahead to find version within multiline table
      const name = m[1];
      let j = i + 1;
      let version: string | undefined;
      while (j < lines.length && !lines[j].includes("}")) {
        const t = lines[j].trim();
        const v = t.match(/version\s*=\s*"([^"]+)"/);
        if (v) version = v[1];
        j++;
      }
      i = j; // jump to closing
      if (version) {
        if (section === "deps") deps[name] = version;
        else devDeps[name] = version;
      }
      continue;
    }
  }

  return { deps, devDeps };
}
