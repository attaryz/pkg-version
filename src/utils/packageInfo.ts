import * as path from "path";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { execSync } from "child_process";
import * as vscode from "vscode";

export interface PackageInfo {
  packageManager: string;
  packageManagerVersion?: string;
  language: string;
  runtime: string;
  description?: string;
  homepage?: string;
  repository?: string;
  author?: string;
  license?: string;
  logoPath?: string | vscode.Uri;
  dependencies?: { [key: string]: string };
  devDependencies?: { [key: string]: string };
}

/**
 * Gets the installed Node.js version
 */
function getNodeVersion(): string {
  try {
    return execSync('node -v').toString().trim();
  } catch (err) {
    return "Node.js";
  }
}

/**
 * Gets the installed npm version
 */
function getNpmVersion(): string {
  try {
    return execSync('npm -v').toString().trim();
  } catch (err) {
    return "";
  }
}

/**
 * Gets the installed PHP version
 */
function getPhpVersion(): string {
  try {
    return execSync('php -v').toString().split('\n')[0].match(/PHP (\d+\.\d+\.\d+)/)?.[1] || "PHP";
  } catch (err) {
    return "PHP";
  }
}

/**
 * Gets the installed Composer version
 */
function getComposerVersion(): string {
  try {
    return execSync('composer -V').toString().match(/Composer version (\d+\.\d+\.\d+)/)?.[1] || "";
  } catch (err) {
    return "";
  }
}

/**
 * Gets the installed Python version
 */
function getPythonVersion(): string {
  try {
    return execSync('python --version').toString().match(/Python (\d+\.\d+\.\d+)/)?.[1] || "Python";
  } catch (err) {
    try {
      return execSync('python3 --version').toString().match(/Python (\d+\.\d+\.\d+)/)?.[1] || "Python";
    } catch (err2) {
      return "Python";
    }
  }
}

/**
 * Gets the installed pip version
 */
function getPipVersion(): string {
  try {
    return execSync('pip --version').toString().match(/pip (\d+\.\d+)/)?.[1] || "";
  } catch (err) {
    try {
      return execSync('pip3 --version').toString().match(/pip (\d+\.\d+)/)?.[1] || "";
    } catch (err2) {
      return "";
    }
  }
}

/**
 * Gets the installed Dart SDK version
 */
function getDartVersion(): string {
  try {
    return execSync('dart --version').toString().match(/Dart SDK version: (\d+\.\d+\.\d+)/)?.[1] || "Dart SDK";
  } catch (err) {
    return "Dart SDK";
  }
}

/**
 * Gets the installed pub version
 */
function getPubVersion(): string {
  try {
    // pub is part of Dart SDK, version shown in dart --version
    return execSync('dart --version').toString().match(/Dart SDK version: (\d+\.\d+\.\d+)/)?.[1] || "";
  } catch (err) {
    return "";
  }
}

/**
 * Gets the installed Poetry version
 */
function getPoetryVersion(): string {
  try {
    return execSync('poetry --version').toString().match(/Poetry (?:version )?(\d+\.\d+\.\d+)/)?.[1] || "";
  } catch (err) {
    return "";
  }
}

/**
 * Get logo URI for a package manager
 * 
 * @param packageManager The package manager name
 * @returns URI for the package manager logo
 */
function getLogoUri(packageManager: string): vscode.Uri | undefined {
  // Use built-in file icons from VS Code or create a path to custom icons
  // For now, we'll use VS Code's built-in file icons
  const iconMap: { [key: string]: string } = {
    'npm': 'npm',
    'Composer': 'composer',
    'pip': 'python',
    'poetry': 'python',
    'pub': 'dart',
    'yarn': 'yarn'
  };

  // Using VS Code ThemeIcon approach
  return undefined; // Will use ThemeIcon in the dependency provider
}

/**
 * Extracts additional package information from package.json
 * 
 * @param manifestPath Path to the package.json file
 * @returns Additional package information
 */
function getNpmPackageDetails(manifestPath: string): Partial<PackageInfo> {
  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const packageJson = JSON.parse(content);
    
    // Extract dependencies directly from package.json
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};
    
    return {
      description: packageJson.description,
      homepage: packageJson.homepage,
      repository: typeof packageJson.repository === 'string' 
        ? packageJson.repository 
        : packageJson.repository?.url,
      author: typeof packageJson.author === 'string' 
        ? packageJson.author 
        : packageJson.author?.name,
      license: packageJson.license,
      dependencies,
      devDependencies
    };
  } catch (err) {
    console.error("Error reading package.json details:", err);
    return {};
  }
}

/**
 * Extracts additional package information from composer.json
 * 
 * @param manifestPath Path to the composer.json file
 * @returns Additional package information
 */
function getComposerPackageDetails(manifestPath: string): Partial<PackageInfo> {
  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const composerJson = JSON.parse(content);
    
    return {
      description: composerJson.description,
      homepage: composerJson.homepage,
      repository: typeof composerJson.repository === 'string' 
        ? composerJson.repository 
        : composerJson.repository?.url,
      author: composerJson.authors?.[0]?.name,
      license: Array.isArray(composerJson.license) 
        ? composerJson.license.join(', ') 
        : composerJson.license
    };
  } catch (err) {
    console.error("Error reading composer.json details:", err);
    return {};
  }
}

/**
 * Extracts additional package information from pubspec.yaml
 * 
 * @param manifestPath Path to the pubspec.yaml file
 * @returns Additional package information
 */
function getPubspecPackageDetails(manifestPath: string): Partial<PackageInfo> {
  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const pubspecYaml = yaml.load(content) as any;
    
    return {
      description: pubspecYaml.description,
      homepage: pubspecYaml.homepage,
      repository: pubspecYaml.repository,
      author: pubspecYaml.author,
      license: pubspecYaml.license
    };
  } catch (err) {
    console.error("Error reading pubspec.yaml details:", err);
    return {};
  }
}

/**
 * Attempts to determine the package manager, primary language, and runtime
 * information from a given manifest file path. Falls back to reasonable
 * defaults when version constraints cannot be detected.
 *
 * @param manifestPath Absolute file-system path of the manifest
 * @returns PackageInfo object with best‑guess details, or undefined when file not supported.
 */
export function getPackageInfo(manifestPath: string): PackageInfo | undefined {
  const fileName = path.basename(manifestPath);

  try {
    if (fileName === "package.json") {
      const additionalInfo = getNpmPackageDetails(manifestPath);
      return {
        packageManager: "npm",
        packageManagerVersion: getNpmVersion(),
        language: "JavaScript/TypeScript",
        runtime: getNodeVersion(),
        logoPath: getLogoUri("npm"),
        ...additionalInfo
      };
    }

    if (fileName === "composer.json") {
      const additionalInfo = getComposerPackageDetails(manifestPath);
      return {
        packageManager: "Composer",
        packageManagerVersion: getComposerVersion(),
        language: "PHP",
        runtime: getPhpVersion(),
        logoPath: getLogoUri("Composer"),
        ...additionalInfo
      };
    }

    if (fileName === "composer.lock") {
      return {
        packageManager: "Composer",
        packageManagerVersion: getComposerVersion(),
        language: "PHP",
        runtime: getPhpVersion(),
        logoPath: getLogoUri("Composer")
      };
    }

    if (fileName === "requirements.txt") {
      return {
        packageManager: "pip",
        packageManagerVersion: getPipVersion(),
        language: "Python",
        runtime: getPythonVersion(),
        logoPath: getLogoUri("pip")
      };
    }

    if (fileName === "pyproject.toml") {
      return {
        packageManager: "poetry",
        packageManagerVersion: getPoetryVersion(),
        language: "Python",
        runtime: getPythonVersion(),
        logoPath: getLogoUri("poetry")
      };
    }

    if (fileName === "pubspec.yaml" || fileName === "pubspec.yml") {
      const additionalInfo = getPubspecPackageDetails(manifestPath);
      return {
        packageManager: "pub",
        packageManagerVersion: getPubVersion(),
        language: "Dart/Flutter",
        runtime: getDartVersion(),
        logoPath: getLogoUri("pub"),
        ...additionalInfo
      };
    }

    // vendor directory treated as composer project root indicator
    if (fileName === "vendor") {
      return {
        packageManager: "Composer",
        packageManagerVersion: getComposerVersion(),
        language: "PHP",
        runtime: getPhpVersion(),
        logoPath: getLogoUri("Composer")
      };
    }
  } catch (err) {
    console.error("getPackageInfo error: ", err);
    return undefined;
  }

  return undefined;
}