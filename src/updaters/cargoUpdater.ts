import * as vscode from "vscode";
import { Dependency } from "../models/dependency";

/**
 * Updates a crate version in Cargo.toml for [dependencies] or [dev-dependencies].
 * Attempts to preserve simple prefix (^ or ~). Skips complex range constraints.
 */
export async function updateCargoPackage(dependency: Dependency): Promise<boolean> {
  if (!dependency.latestVersion) {
    vscode.window.showErrorMessage(
      "Cannot update this package: missing latest version information"
    );
    return false;
  }

  const parent = dependency.parentFile;
  if (!parent || !parent.endsWith("Cargo.toml")) {
    vscode.window.showErrorMessage("Parent Cargo.toml not found for this dependency");
    return false;
  }

  try {
    const uri = vscode.Uri.file(parent);
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    const lines = text.split(/\r?\n/);

    let section: "none" | "deps" | "dev" = "none";
    let updated = false;

    const name = dependency.label;
    const newVersionRaw = dependency.latestVersion;

    const replaceInlineVersion = (orig: string): string | null => {
      // Preserve simple prefix (^ or ~) if present
      if (/^\^/.test(orig)) return `^${newVersionRaw}`;
      if (/^~/.test(orig)) return `~${newVersionRaw}`;
      // If complex comparator involved, skip (>=, <=, >, <, =, ,)
      if (/[<>]=?|=|,/.test(orig)) return null;
      // Default to exact version
      return `${newVersionRaw}`;
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();

      if (line.startsWith("[")) {
        if (line === "[dependencies]") section = "deps";
        else if (line === "[dev-dependencies]") section = "dev";
        else section = "none";
        continue;
      }

      if (section === "none") continue;

      // Simple assignment: name = "..."
      let m = line.match(new RegExp(`^${escapeRegex(name)}\\s*=\\s*"([^"]+)"`));
      if (m) {
        const orig = m[1];
        const next = replaceInlineVersion(orig);
        if (next === null) {
          vscode.window.showWarningMessage(
            `Skipping update for ${name}: complex version constraint detected.`
          );
          return false;
        }
        const newLine = raw.replace(`"${orig}"`, `"${next}"`);
        lines[i] = newLine;
        updated = true;
        break;
      }

      // Inline table: name = { version = "...", ... }
      m = line.match(new RegExp(`^${escapeRegex(name)}\\s*=\\s*\\{(.*)\\}`));
      if (m) {
        const inside = m[1];
        const vm = inside.match(/version\s*=\s*"([^"]+)"/);
        if (!vm) {
          vscode.window.showWarningMessage(
            `Skipping update for ${name}: no version field in inline table.`
          );
          return false;
        }
        const orig = vm[1];
        const next = replaceInlineVersion(orig);
        if (next === null) {
          vscode.window.showWarningMessage(
            `Skipping update for ${name}: complex version constraint detected.`
          );
          return false;
        }
        const newInside = inside.replace(
          /version\s*=\s*"([^"]+)"/,
          `version = "${next}"
`
        ).trim();
        const prefix = raw.substring(0, raw.indexOf("{"));
        lines[i] = `${prefix}{ ${newInside} }`;
        updated = true;
        break;
      }

      // Multiline table start: name = {
      m = line.match(new RegExp(`^${escapeRegex(name)}\\s*=\\s*\\{$`));
      if (m) {
        let j = i + 1;
        let versionLineIndex: number | null = null;
        let k = j;
        while (k < lines.length && !lines[k].includes("}")) {
          const t = lines[k].trim();
          const vm = t.match(/version\s*=\s*"([^"]+)"/);
          if (vm) {
            versionLineIndex = k;
            break;
          }
          k++;
        }
        if (versionLineIndex === null) {
          vscode.window.showWarningMessage(
            `Skipping update for ${name}: no version field found in table.`
          );
          return false;
        }
        const tRaw = lines[versionLineIndex];
        const t = tRaw.trim();
        const orig = (t.match(/version\s*=\s*"([^"]+)"/) || [])[1];
        if (!orig) {
          return false;
        }
        const next = replaceInlineVersion(orig);
        if (next === null) {
          vscode.window.showWarningMessage(
            `Skipping update for ${name}: complex version constraint detected.`
          );
          return false;
        }
        lines[versionLineIndex] = tRaw.replace(
          /version\s*=\s*"([^"]+)"/,
          `version = "${next}"`
        );
        updated = true;
        break;
      }
    }

    if (!updated) {
      vscode.window.showWarningMessage(
        `Package ${name} not found in ${vscode.workspace.asRelativePath(uri)}`
      );
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    const whole = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(text.length)
    );
    edit.replace(uri, whole, lines.join("\n"));
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      vscode.window.showInformationMessage(
        `Updated ${name} to ${newVersionRaw}`
      );
      return true;
    }
    vscode.window.showErrorMessage(`Failed to update ${name}`);
    return false;
  } catch (e: any) {
    console.error("Error updating Cargo.toml:", e);
    vscode.window.showErrorMessage(`Error updating Cargo.toml: ${e.message}`);
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
