# Package Version Checker

![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Abdullah-Dev.pkg-version)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/Abdullah-Dev.pkg-version)
![Visual Studio Marketplace Last Updated](https://img.shields.io/visual-studio-marketplace/last-updated/Abdullah-Dev.pkg-version)


A VS Code extension for checking and updating package dependencies across multiple package managers.

## Features

* Support for multiple package managers:
  * npm (Node.js)
  * Composer (PHP)
  * PyPI (Python)
  * Pub.dev (Dart/Flutter)
* Visual indicators showing update status (major, minor, patch)
* One-click dependency updates
* Bulk update capabilities
* Status bar notification of available updates
* Security vulnerability scanning:
  * Integration with Snyk API for vulnerability detection
  * Visual indicators for vulnerable packages
  * Detailed vulnerability information on hover
* Flexible exclusion options:
  * Folder exclusion for large projects
  * Custom pattern exclusion for granular control
  * Automatic exclusion of lock files (package-lock.json, composer.lock, etc.)
* Improved user interface:
  * Enhanced options menu with intuitive icons
  * Organized command grouping for better usability
  * Consistent visual styling throughout the extension

## Code Structure

The codebase has been modularized for better maintainability and future extensibility:

```
src/
├── models/
│   └── dependency.ts            # Dependency TreeItem model
├── utils/
│   ├── fileUtils.ts             # File system utilities 
│   ├── registryFetchers.ts      # Registry API interaction
│   └── versionUtils.ts          # Version comparison utilities
├── parsers/
│   ├── npmParser.ts             # package.json parser
│   ├── composerParser.ts        # composer.json parser
│   ├── pythonParser.ts          # requirements.txt parser
│   └── dartParser.ts            # pubspec.yaml parser
├── updaters/
│   ├── npmUpdater.ts            # npm package updater
│   ├── composerUpdater.ts       # composer package updater
│   ├── pythonUpdater.ts         # python package updater
│   └── dartUpdater.ts           # dart package updater
├── dependencyProvider.ts        # TreeView data provider
└── extension.ts                 # Extension entry point
```

## Extension Design

The extension follows a modular design pattern:

1. **Models**: Data structures used throughout the application
2. **Utils**: Shared utility functions for file operations, version comparison, and registry API interaction
3. **Parsers**: Package-manager specific parsers to extract dependency information
4. **Updaters**: Package-manager specific update mechanisms
5. **Provider**: Core TreeView implementation that coordinates the components

## Development

### Adding Support for a New Package Manager

To add support for a new package manager:

1. Create a new parser in `src/parsers/` that implements dependency extraction
2. Create a new registry fetcher in `src/utils/registryFetchers.ts`
3. Create a new updater in `src/updaters/`
4. Add detection logic to `dependencyProvider.ts`

### Running the Extension

1. Clone the repository
2. Run `npm install` to install dependencies
3. Press `F5` to start debugging

## Future Improvements

* Add support for more package managers (Cargo, Go Modules, etc.)
* Implement advanced version comparison for complex version constraints
* Add batch update mechanisms for dependencies
* Implement caching to reduce API calls
* Add offline mode for environments without internet access

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

### Checking for Updates

1. Open the "PACKAGE DEPENDENCIES" view
2. Click the refresh icon to check for updates
3. Dependencies with available updates will display colored indicators:
   * 🔴 Major update available
   * 🟠 Minor update available
   * 🟡 Patch update available

### Updating Packages

1. To update an individual package, click the update icon next to it
2. To update all packages, click the update icon in the view's title bar
3. The extension will perform the update and show the results

### Security Vulnerability Scanning

1. Configure your Snyk API token in the extension settings:
   * Get an API token from [Snyk](https://app.snyk.io/account)
   * Open VS Code settings and search for "pkg-version"
   * Add your token to the "Snyk API Token" field
2. Click the shield icon in the view's title bar to scan for vulnerabilities
3. Vulnerable packages will display a shield indicator
4. Hover over vulnerable packages to see detailed information

### Managing Exclusions

1. Right-click on a folder in the Explorer view and select "Exclude Folder from Package Checks"
2. To add custom exclusion patterns, click the gear icon in the view's title bar
3. Manage exclusions from the extension settings

### Commands

The extension provides several commands that can be accessed via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- **Check Package Updates**: Manually trigger a check for outdated dependencies
- **Refresh Dependencies**: Refresh the dependencies tree view
- **Update Package**: Update a selected package to the latest version
- **Update All Packages**: Update all outdated packages at once
- **Exclude Folder**: Exclude a folder from dependency scanning
- **Exclude Custom Pattern**: Exclude specific files or nested directories using glob patterns
- **Manage Exclusions**: View and remove folder exclusions

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

## Features in Detail

### Status Counter

The status bar displays a summary of your dependencies' health:
- 🔴 Number of packages with major updates available
- 🟠 Number of packages with minor updates available
- 🟡 Number of packages with patch updates available
- ✅ Number of up-to-date packages

Clicking on the counter will refresh your dependencies.

### Version Preservation

When updating packages, the extension preserves the original version constraints:
- `^1.0.0` → `^2.0.0` (preserves caret)
- `~1.0.0` → `~1.2.0` (preserves tilde)
- `>=1.0.0` → `>=1.2.0` (preserves greater than or equal)

### Multi-File Support

If your workspace contains multiple package files of the same type, the extension will ask you which file to update when using the update functionality.

## Planned Features

- Support for additional package managers (Cargo, Go modules, etc.)
- Improved handling of complex version constraints
- Caching to reduce API calls
- Offline mode
- Security vulnerability checking via Snyk API
- Separation of dependencies from dev-dependencies in UI
- Package info hover cards
- See [TASKS.md](TASKS.md) for more planned features and their implementation status

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

[MIT](LICENSE) 