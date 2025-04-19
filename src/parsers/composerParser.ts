import * as vscode from "vscode";
import * as path from "path";
import { Dependency } from "../models/dependency";
import { fetchLatestPackagistVersion } from "../utils/registryFetchers";
import { getUpdateType } from "../utils/versionUtils";
import { pathExists } from "../utils/fileUtils";

/**
 * Parses a composer.json file and extracts all dependencies with their versions.
 * For each dependency, fetches the latest version from Packagist and
 * determines the update type.
 *
 * @param composerJsonUri - URI of the composer.json file
 * @returns Promise resolving to array of dependencies
 */
export async function getDepsInComposerJson(
  composerJsonUri: vscode.Uri
): Promise<Dependency[]> {
  if (!pathExists(composerJsonUri.fsPath)) {
    return Promise.resolve([]);
  }
  try {
    const buffer = await vscode.workspace.fs.readFile(composerJsonUri);
    const content = Buffer.from(buffer).toString("utf8");
    const json = JSON.parse(content);
    let depsPromises: Promise<Dependency | null>[] = [];

    const processComposerDependencies = async (
      dependencies: { [key: string]: string } | undefined,
      isDev: boolean
    ) => {
      if (!dependencies) return;

      for (const moduleName of Object.keys(dependencies)) {
        const currentVersion = dependencies[moduleName];

        // Filter out php and extensions before fetching
        if (
          moduleName.toLowerCase() === "php" ||
          moduleName.startsWith("ext-")
        ) {
          continue; // Skip platform requirements
        }

        depsPromises.push(
          (async () => {
            const latestVersion = await fetchLatestPackagistVersion(
              moduleName
            );
            if (latestVersion) {
              // Note: Composer version constraints can be complex (^, ~, >).
              // getUpdateType uses basic semver comparison. More robust check might be needed.
              const updateType = getUpdateType(currentVersion, latestVersion);
              return new Dependency(
                moduleName,
                currentVersion,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                latestVersion,
                updateType,
                "composer",
                composerJsonUri.fsPath,
                isDev
              );
            } else {
              return new Dependency(
                moduleName,
                currentVersion,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                "none",
                "composer",
                composerJsonUri.fsPath,
                isDev
              );
            }
          })()
        );
      }
    };

    await processComposerDependencies(json.require, false);
    await processComposerDependencies(json["require-dev"], true);

    // TODO: Add support for additional Composer dependency sections

    const resolvedDeps = await Promise.all(depsPromises);
    return resolvedDeps.filter((d): d is Dependency => d !== null);
  } catch (err: any) {
    console.error(`Error reading or parsing ${composerJsonUri.fsPath}:`, err);
    vscode.window.showErrorMessage(
      `Failed to read dependencies from ${vscode.workspace.asRelativePath(
        composerJsonUri
      )}`
    );
    return [];
  }
}

/**
 * Parses a composer.lock file and extracts all dependencies.
 * This provides the most accurate view of currently installed packages.
 *
 * @param composerLockUri - URI of the composer.lock file
 * @returns Promise resolving to array of dependencies
 */
export async function getDepsFromComposerLock(
  composerLockUri: vscode.Uri
): Promise<Dependency[]> {
  if (!pathExists(composerLockUri.fsPath)) {
    return Promise.resolve([]);
  }
  try {
    const buffer = await vscode.workspace.fs.readFile(composerLockUri);
    const content = Buffer.from(buffer).toString("utf8");
    const lockData = JSON.parse(content);
    const dependencies: Dependency[] = [];

    // Process regular packages
    if (lockData.packages && Array.isArray(lockData.packages)) {
      for (const pkg of lockData.packages) {
        if (pkg.name && pkg.version) {
          // Get the latest version from Packagist
          const latestVersion = await fetchLatestPackagistVersion(pkg.name);

          if (latestVersion) {
            const updateType = getUpdateType(pkg.version, latestVersion);
            dependencies.push(
              new Dependency(
                pkg.name,
                pkg.version,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                latestVersion,
                updateType,
                "composer",
                composerLockUri.fsPath
              )
            );
          } else {
            dependencies.push(
              new Dependency(
                pkg.name,
                pkg.version,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                "none",
                "composer",
                composerLockUri.fsPath
              )
            );
          }
        }
      }
    }

    // Process dev packages
    if (lockData["packages-dev"] && Array.isArray(lockData["packages-dev"])) {
      for (const pkg of lockData["packages-dev"]) {
        if (pkg.name && pkg.version) {
          // Get the latest version from Packagist
          const latestVersion = await fetchLatestPackagistVersion(pkg.name);

          if (latestVersion) {
            const updateType = getUpdateType(pkg.version, latestVersion);
            dependencies.push(
              new Dependency(
                pkg.name,
                pkg.version,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                latestVersion,
                updateType,
                "composer",
                composerLockUri.fsPath,
                true // Mark as dev dependency
              )
            );
          } else {
            dependencies.push(
              new Dependency(
                pkg.name,
                pkg.version,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                "none",
                "composer",
                composerLockUri.fsPath,
                true // Mark as dev dependency
              )
            );
          }
        }
      }
    }

    return dependencies;
  } catch (err: any) {
    console.error(`Error reading or parsing ${composerLockUri.fsPath}:`, err);
    vscode.window.showErrorMessage(
      `Failed to read dependencies from ${vscode.workspace.asRelativePath(
        composerLockUri
      )}`
    );
    return [];
  }
}

/**
 * Scans the vendor directory to find installed Composer packages
 * and creates dependency objects for them.
 *
 * This is used when composer.json is not available or as a supplemental
 * source of information about installed packages.
 *
 * @param vendorDir - The URI of the vendor directory
 * @returns Promise resolving to array of dependencies
 */
export async function getDepsFromVendorDirectory(
  vendorDir: vscode.Uri
): Promise<Dependency[]> {
  try {
    // First look for composer.lock file in the parent directory of vendor
    // This is typically where Composer places the vendor directory, and composer.lock has the most accurate info
    const vendorParentDir = path.dirname(vendorDir.fsPath);
    const composerLockPath = path.join(vendorParentDir, "composer.lock");

    if (pathExists(composerLockPath)) {
      console.log(
        `Found composer.lock at ${composerLockPath}, parsing installed packages`
      );
      return getDepsFromComposerLock(vscode.Uri.file(composerLockPath));
    }

    // Next look for the installed.json file which contains detailed information about all installed packages
    // Since Composer 2.0, this file is in vendor/composer/installed.json
    // For older versions, it was directly in vendor/composer
    const installedJsonPathsToTry = [
      path.join(vendorDir.fsPath, "composer", "installed.json"),
      path.join(vendorDir.fsPath, "composer", "installed.php"), // Some setups use PHP format
    ];

    console.log(
      `Checking for installed.json in: ${installedJsonPathsToTry.join(", ")}`
    );

    // Try to find and parse installed.json first (more efficient and accurate)
    for (const installedJsonPath of installedJsonPathsToTry) {
      if (pathExists(installedJsonPath)) {
        console.log(`Found installed manifest at: ${installedJsonPath}`);
        try {
          const installedJsonUri = vscode.Uri.file(installedJsonPath);
          const buffer = await vscode.workspace.fs.readFile(installedJsonUri);
          const content = Buffer.from(buffer).toString("utf8");

          // Only proceed if it seems to be JSON content
          if (
            content.trim().startsWith("{") ||
            content.trim().startsWith("[")
          ) {
            const json = JSON.parse(content);

            // Handle both old and new format of installed.json
            const packages = json.packages || json; // New format has a packages property

            if (Array.isArray(packages)) {
              console.log(
                `Found ${packages.length} packages in installed.json`
              );
              const dependencies: Dependency[] = [];

              for (const pkg of packages) {
                if (pkg.name && pkg.version) {
                  console.log(
                    `Processing package from installed.json: ${pkg.name} (${pkg.version})`
                  );

                  // Get the latest version from Packagist
                  const latestVersion = await fetchLatestPackagistVersion(
                    pkg.name
                  );

                  const isDev = pkg.dev || false;

                  if (latestVersion) {
                    const updateType = getUpdateType(
                      pkg.version,
                      latestVersion
                    );
                    dependencies.push(
                      new Dependency(
                        pkg.name,
                        pkg.version,
                        vscode.TreeItemCollapsibleState.None,
                        undefined,
                        latestVersion,
                        updateType,
                        "composer",
                        installedJsonPath,
                        isDev
                      )
                    );
                  } else {
                    dependencies.push(
                      new Dependency(
                        pkg.name,
                        pkg.version,
                        vscode.TreeItemCollapsibleState.None,
                        undefined,
                        undefined,
                        "none",
                        "composer",
                        installedJsonPath,
                        isDev
                      )
                    );
                  }
                }
              }

              return dependencies;
            }
          }
        } catch (err) {
          console.error(
            `Error parsing installed.json at ${installedJsonPath}:`,
            err
          );
          // Continue to fallback method
        }
      }
    }

    // Fallback: Find all composer.json files inside vendor packages
    console.log(
      "Installed.json not found or could not be parsed, falling back to scanning individual packages"
    );

    // First list the directories inside vendor to find package directories
    try {
      const entries = await vscode.workspace.fs.readDirectory(vendorDir);
      console.log(`Found ${entries.length} entries in vendor directory`);

      const dependencies: Dependency[] = [];

      // Process each vendor namespace directory
      for (const [name, type] of entries) {
        // Skip files and composer directory
        if (type !== vscode.FileType.Directory || name === "composer") {
          continue;
        }

        const vendorNameDir = path.join(vendorDir.fsPath, name);
        console.log(`Scanning vendor namespace: ${name}`);

        try {
          // List packages within this vendor namespace
          const packageEntries = await vscode.workspace.fs.readDirectory(
            vscode.Uri.file(vendorNameDir)
          );

          for (const [packageName, packageType] of packageEntries) {
            if (packageType !== vscode.FileType.Directory) {
              continue;
            }

            const packageDir = path.join(vendorNameDir, packageName);
            const composerJsonPath = path.join(packageDir, "composer.json");

            // Check if this package has a composer.json
            if (pathExists(composerJsonPath)) {
              try {
                const fullPackageName = `${name}/${packageName}`;
                console.log(`Found package: ${fullPackageName}`);

                const buffer = await vscode.workspace.fs.readFile(
                  vscode.Uri.file(composerJsonPath)
                );
                const content = Buffer.from(buffer).toString("utf8");
                const json = JSON.parse(content);

                // Use the name from composer.json if available
                const actualPackageName = json.name || fullPackageName;

                // Try to get the version from composer.json
                let packageVersion = json.version;

                // If version is not in composer.json, try to find it in other common locations
                if (!packageVersion) {
                  // Try looking for VERSION file
                  const versionFilePath = path.join(packageDir, "VERSION");
                  if (pathExists(versionFilePath)) {
                    try {
                      const versionBuffer =
                        await vscode.workspace.fs.readFile(
                          vscode.Uri.file(versionFilePath)
                        );
                      packageVersion = Buffer.from(versionBuffer)
                        .toString("utf8")
                        .trim();
                    } catch (err) {
                      console.error(
                        `Error reading VERSION file for ${actualPackageName}:`,
                        err
                      );
                    }
                  }

                  // If still no version, use "unknown"
                  if (!packageVersion) {
                    packageVersion = "unknown";
                  }
                }

                // Get the latest version from Packagist
                const latestVersion = await fetchLatestPackagistVersion(
                  actualPackageName
                );

                // Determine if this is a dev dependency (best guess)
                const isDev = json.type === "dev" || json.dev || false;

                // Create a dependency object
                if (latestVersion) {
                  // For "unknown" version, always show as needing update
                  const updateType =
                    packageVersion === "unknown"
                      ? "patch"
                      : getUpdateType(packageVersion, latestVersion);
                  dependencies.push(
                    new Dependency(
                      actualPackageName,
                      packageVersion,
                      vscode.TreeItemCollapsibleState.None,
                      undefined,
                      latestVersion,
                      updateType,
                      "composer",
                      composerJsonPath,
                      isDev
                    )
                  );
                } else {
                  dependencies.push(
                    new Dependency(
                      actualPackageName,
                      packageVersion,
                      vscode.TreeItemCollapsibleState.None,
                      undefined,
                      undefined,
                      "none",
                      "composer",
                      composerJsonPath,
                      isDev
                    )
                  );
                }
              } catch (err) {
                console.error(
                  `Error processing package ${name}/${packageName}:`,
                  err
                );
                // Continue with the next package
              }
            }
          }
        } catch (err) {
          console.error(
            `Error reading vendor namespace directory ${vendorNameDir}:`,
            err
          );
          // Continue with the next vendor namespace
        }
      }

      return dependencies;
    } catch (err) {
      console.error(`Error reading vendor directory structure: ${err}`);
      return [];
    }
  } catch (err: any) {
    console.error(
      `Error scanning vendor directory ${vendorDir.fsPath}:`,
      err
    );
    return [];
  }
} 