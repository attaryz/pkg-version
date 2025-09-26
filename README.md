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
  * Poetry (Python)
  * Pub.dev (Dart/Flutter)
* Visual indicators showing update status (major, minor, patch)
* One-click dependency updates
* Bulk update capabilities
* Status bar notification of available updates
* File Information View:
  * Runtime and language information for the selected file
  * Package manager details for manifest files
  * Automatic updates when switching between files
* Security vulnerability scanning:
  * Integration with Snyk API for vulnerability detection
  * Visual indicators for vulnerable packages
  * Detailed vulnerability information on hover
* Flexible exclusion options:
  * Folder exclusion for large projects
  * Custom pattern exclusion for granular control
  * Automatic exclusion of lock files (package-lock.json, composer.lock, etc.)
* Package Management Context Menu:
  * Right-click on dependencies to see available actions
  * Remove packages directly from the tree view
  * View detailed package information in a webview panel
  * Update packages with a single click
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
│   ├── poetryParser.ts          # pyproject.toml parser
│   └── dartParser.ts            # pubspec.yaml parser
├── updaters/
│   ├── npmUpdater.ts            # npm package updater
│   ├── composerUpdater.ts       # composer package updater
│   ├── pythonUpdater.ts         # python package updater
│   ├── poetryUpdater.ts         # poetry package updater
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
4. You can also right-click on any package in the tree view and select "Update Package"

### Managing Packages via Context Menu

1. Right-click on any package in the tree view to access the context menu
2. Available options include:
   * Update Package: Update the package to its latest version
   * Remove Package: Remove the package from its parent manifest file
   * View Package Info: Open a detailed information panel about the package
3. Package info view includes:
   * Package logo or icon (when available)
   * Version information (current and latest)
   * Description, license, and author
   * Homepage and repository links
   * Dependencies of the selected package
   * Last published date and other metadata

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

### Using the File Info View

1. Open the "PACKAGE VERSIONS" view in the sidebar
2. Select the "File Info" tab
3. Open any file in the editor to see its information
4. For manifest files (package.json, composer.json, etc.), you'll see:
   - Runtime information (Node.js, PHP, Python, etc.)
   - Language information
   - Package manager details
5. For other files, you'll see basic file type and language information
6. The view updates automatically when you switch between files

### Commands

The extension provides several commands that can be accessed via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- **Check Package Updates**: Manually trigger a check for outdated dependencies
- **Refresh Dependencies**: Refresh the dependencies tree view
- **Update Package**: Update a selected package to the latest version
- **Update All Packages**: Update all outdated packages at once
- **Generate requirements.txt from Poetry**: Convert Poetry dependencies to requirements.txt format
- **Exclude Folder**: Exclude a folder from dependency scanning
- **Exclude Custom Pattern**: Exclude specific files or nested directories using glob patterns
- **Manage Exclusions**: View and remove folder exclusions

## Extension Settings

This extension contributes the following settings:

* `pkgVersion.excludeFolders`: List of glob patterns for folders to exclude from scanning

## Supported Package Managers

| Package Manager | File | Registry | Requirements |
|----------------|------|----------|------------|
| npm/yarn | package.json | npm registry | Node.js installed |
| Composer | composer.json | Packagist | PHP and Composer CLI installed and in PATH |
| Python | requirements.txt | PyPI | Python installed |
| Poetry | pyproject.toml | PyPI | Python and Poetry installed |
| Dart/Flutter | pubspec.yaml | pub.dev | Dart/Flutter SDK installed |

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

## Development & CI/CD

### GitHub Actions Workflows

This project includes automated workflows for continuous integration and deployment:

#### CI Workflow (`.github/workflows/ci.yml`)
- Runs on every push and pull request to main branches
- Tests across multiple Node.js versions (16, 18, 20)
- Performs linting, compilation, and testing
- Builds extension package for verification
- Uploads build artifacts for review

#### Build & Publish Workflow (`.github/workflows/build-and-publish.yml`)
- Triggers on version tags (e.g., `v2.1.0`) or manual dispatch
- Builds and packages the extension
- Publishes to VS Code Marketplace
- Publishes to OpenVSX Registry
- Creates GitHub releases with downloadable `.vsix` files
- Uploads extension artifacts for download

### Publishing a New Version

1. **Automatic (Recommended)**: Create and push a version tag:
   ```bash
   git tag v2.1.1
   git push origin v2.1.1
   ```

2. **Manual**: Use the "Build and Publish" workflow dispatch in GitHub Actions with a version number.

### Setup Requirements

To use the publishing workflow, configure these repository secrets:
- `VSCE_PAT`: Personal Access Token for VS Code Marketplace publishing
- `OVSX_PAT`: Personal Access Token for OpenVSX Registry publishing

For detailed setup instructions, see [`.github/SETUP.md`](.github/SETUP.md).

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

[MIT](LICENSE)