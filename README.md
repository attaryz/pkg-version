# Package Version Checker

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/pkg-version.svg)](https://marketplace.visualstudio.com/items?itemName=pkg-version)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/pkg-version.svg)](https://marketplace.visualstudio.com/items?itemName=pkg-version)

A VS Code extension that helps you keep track of package dependencies across multiple package managers. It automatically scans your workspace for package files and shows you which dependencies are outdated.

## Features

- **Multi-Package Manager Support**: Works with npm (package.json), Composer (composer.json), Python (requirements.txt), and Dart/Flutter (pubspec.yaml)
- **Update Status Indicators**: Visual indicators show the type of update available (major, minor, patch)
- **Tree View**: Organized view of all package files and their dependencies
- **Exclusion System**: Ability to exclude folders from scanning to improve performance

![Feature Overview](media/feature-overview.png)

## Usage

### Viewing Dependencies

1. Open the Explorer view in VS Code
2. Look for the "PACKAGE DEPENDENCIES" section in the sidebar
3. Click on a package file to expand and see its dependencies
4. Dependencies with available updates will show the current and latest version with color-coded indicators:
   - 🔴 Major updates (potentially breaking changes)
   - 🟠 Minor updates (new features, non-breaking)
   - 🟡 Patch updates (bug fixes)
   - 🔵 Prerelease versions

### Commands

The extension provides several commands that can be accessed via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- **Check Package Updates**: Manually trigger a check for outdated dependencies
- **Refresh Dependencies**: Refresh the dependencies tree view
- **Exclude Folder**: Exclude a folder from dependency scanning
- **Manage Exclusions**: View and remove folder exclusions

### Excluding Folders

To exclude folders from scanning (useful for large monorepos or test directories):

1. Right-click on a folder in the Explorer view
2. Select "Exclude Folder from Package Checks"
3. The folder will be excluded from future scans

To manage exclusions:
1. Open the Command Palette
2. Search for "Package Version: Manage Exclusions"
3. Select the exclusions you want to remove

## Extension Settings

This extension contributes the following settings:

* `pkgVersion.excludeFolders`: List of glob patterns for folders to exclude from scanning

## Supported Package Managers

| Package Manager | File | Registry |
|----------------|------|----------|
| npm/yarn | package.json | npm registry |
| Composer | composer.json | Packagist |
| Python | requirements.txt | PyPI |
| Dart/Flutter | pubspec.yaml | pub.dev |

## Planned Features

- Support for additional package managers (Cargo, Go modules, etc.)
- Batch update mechanism for dependencies
- Improved handling of complex version constraints
- Caching to reduce API calls
- Offline mode

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

[MIT](LICENSE) 