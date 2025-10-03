# Package Version Checker

![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Abdullah-Dev.pkg-version)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/Abdullah-Dev.pkg-version)
![Visual Studio Marketplace Last Updated](https://img.shields.io/visual-studio-marketplace/last-updated/Abdullah-Dev.pkg-version)

Check and update package dependencies across multiple package managers. Scan for security vulnerabilities with built-in OSV.dev integration.

## Features

### 📦 Package Management
- **Multi-ecosystem support**: npm, Yarn, PNPM, Composer, pip, Poetry, pub.dev
- **Update indicators**: Visual badges for major, minor, and patch updates
- **One-click updates**: Update individual packages or all at once
- **Status bar counter**: Shows outdated packages at a glance

### 🛡️ Security Scanning
- **Security Report view**: Dedicated tab showing vulnerable packages by severity (Critical, High, Medium, Low)
- **OSV.dev integration**: Free vulnerability scanning, no configuration required (enabled by default)
- **GitHub Advisory Database**: Optional additional coverage
- **Snyk integration**: Optional enhanced scanning with detailed remediation advice
- **Accurate scanning**: Uses actual installed versions from lockfiles and `node_modules`
- **Double-click to view**: Click any vulnerable package to see full CVE details

### 📊 Project Information
- **Dependencies view**: Tree view of all project dependencies with update status
- **File Info view**: Shows runtime, language, and package manager for active file
- **Package details**: Right-click any package to view metadata, license, homepage, and dependencies

### ⚙️ Customization
- **Folder exclusion**: Exclude directories from scanning (e.g., `vendor`, `node_modules`)
- **Pattern exclusion**: Use glob patterns for granular control
- **Auto-exclusion**: Lock files and common artifacts automatically excluded

## Quick Start

1. Open the **Package Versions** sidebar (Activity Bar icon)
2. View all dependencies with update indicators:
   - 🔴 Major updates (breaking changes)
   - 🟠 Minor updates (new features)
   - 🟡 Patch updates (bug fixes)
3. Click refresh icon to check for updates
4. Click update icon next to a package to update it, or use "Update All" for bulk updates

### Security Scanning

1. Click the **shield icon** (🛡️) in the Package Versions sidebar
2. Open the **Security Report** tab to see vulnerable packages grouped by severity
3. Double-click any package to view full CVE details
4. OSV.dev scans automatically (no configuration needed)

**Optional: Enable Additional Providers**
- Open Settings → search `pkgVersion`
- Enable `useGitHubAdvisoryProvider` for GitHub Advisory Database
- Enable `useSnykProvider` and add API token for Snyk integration

### Package Management

**Right-click any package** to:
- Update to latest version
- Remove from manifest
- View detailed info (metadata, license, dependencies, homepage)

## Supported Ecosystems

| Package Manager | Manifest File | Registry |
|----------------|---------------|----------|
| npm/Yarn/PNPM | `package.json` | npmjs.com |
| Composer | `composer.json` | packagist.org |
| pip | `requirements.txt` | pypi.org |
| Poetry | `pyproject.toml` | pypi.org |
| Dart/Flutter | `pubspec.yaml` | pub.dev |

## Settings

- `pkgVersion.excludeFolders` - Glob patterns for folders to exclude
- `pkgVersion.useOSVProvider` - Enable OSV.dev scanning (default: true)
- `pkgVersion.useGitHubAdvisoryProvider` - Enable GitHub Advisory Database
- `pkgVersion.useSnykProvider` - Enable Snyk scanning
- `pkgVersion.snykApiToken` - Snyk API token (required if Snyk enabled)
- `pkgVersion.snykOrgId` - Snyk organization ID (required if Snyk enabled)

## Commands

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `Check for Security Vulnerabilities` - Scan all dependencies
- `Refresh Dependencies` - Reload dependency tree
- `Update All Packages` - Bulk update all outdated packages
- `Exclude Folder` - Exclude a folder from scanning
- `Manage Exclusions` - View and remove exclusions
- `Generate requirements.txt from Poetry` - Convert Poetry to pip format

## License

[MIT](LICENSE)