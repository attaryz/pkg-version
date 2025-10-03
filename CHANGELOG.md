# Change Log

All notable changes to the "pkg-version" extension will be documented in this file.

## [2.5.2] - 2025-10-03

### Fixed
- Fixed `command 'pkg-version.refreshDependencies' not found` error by adding `onStartupFinished` to activation events, ensuring the command is registered on VS Code startup.
- Fixed `graceful-fs` error during `vsce` packaging by adding `@vscode/vsce` as a development dependency and using the `--no-dependencies` flag to bypass Yarn PnP compatibility issues.

## [2.5.1] - 2025-10-02

### Fixed
- Fixed Yarn PnP (Plug'n'Play) compatibility issues with VSCE packaging
- Resolved "graceful-fs not declared in dependencies" error during packaging
- Successfully packaged extension using npm-based VSCE after temporary Yarn-to-npm switch
- Restored Yarn PnP configuration after successful packaging

## [2.1.1] - 2025-01-27

### Added
- Added GitHub Actions workflows for automated CI/CD
- Added automated building and publishing to VS Code Marketplace
- Added CI workflow for testing across multiple Node.js versions
- Added automated GitHub releases with downloadable extension files
- Added artifact uploads for extension builds

### Fixed
- Fixed logo URL display issue in package info view (removed debug text)
- Improved package info webview display

### Enhanced
- Improved development workflow with automated testing and deployment
- Added comprehensive documentation for CI/CD processes

## [2.1.0] - 2025-01-27

### Added
- Added support for Python Poetry package manager
- Added `pyproject.toml` file parsing for Poetry dependencies
- Added Poetry package updating and removal functionality
- Added command to generate `requirements.txt` from Poetry dependencies
- Added Poetry to activation events for automatic extension loading

### Enhanced
- Extended dependency provider to support Poetry packages
- Added Poetry-specific version constraint handling (^, ~, exact versions)
- Integrated Poetry with existing security vulnerability scanning
- Added Poetry to supported package managers documentation

## [2.0.1] - 2025-04-22

### Fixed
- Fixed "Failed to check vulnerabilities" error when receiving HTTP 403 response from Snyk API
- Improved error handling for Snyk API responses with specific error messages for different HTTP status codes
- Enhanced vulnerability checking to properly handle API errors without showing false success results
- Added more detailed error feedback for token permission issues
- Fixed incorrect Snyk API URL from "https://snyk.io/api/v1" to "https://api.snyk.io/v1"

## [2.2.4] - 2025-04-29

### Fixed
- Added check for Composer installation before trying to use Composer commands
- Added helpful error message with installation instructions when Composer is not found
- Improved error handling for systems without Composer installed
- Fixed "'composer' is not recognized as an internal or external command" error

## [2.2.3] - 2025-04-28

### Fixed
- Fixed package logo display issues in the package info view
- Improved image loading with proper Content-Security-Policy
- Added reliable fallback to generated avatars when logos aren't available
- Implemented better error handling for image loading
- Added diagnostic information to help troubleshoot logo display issues

## [2.2.2] - 2025-04-27

### Added
- Added package logo display in the package info view
- Implemented logo fetching from various package repositories (npm, PyPI, etc.)
- Added fallback initials display when package logo is unavailable

## [2.2.1] - 2025-04-26

### Fixed
- Fixed "command 'pkg-version.viewPackageInfo' not found" error by properly including js-yaml in main dependencies
- Improved build configuration to ensure all dependencies are correctly bundled

## [2.2.0] - 2025-04-25

### Added
- Added context menu to package names in the tree view with the following options:
  - Remove Package: Delete the package from its parent manifest file
  - Update Package: Update the package to its latest version
  - View Package Info: Display detailed information about the package
- Package info view with comprehensive details including:
  - Package metadata (description, license, author)
  - Repository and homepage links
  - Dependency list
  - Download and publishing information

## [2.1.0] - 2025-04-21

### Added
- Added File Info view that displays runtime, language, and package manager information for the selected file
- Automatic file information updates when switching between files in the editor

## [2.0.0] - 2025-04-20

### Added
- Full implementation of security vulnerability checking via Snyk API
- Command to scan all dependencies for known security vulnerabilities
- Visual indicators for vulnerable packages in the dependency tree

### Fixed
- Fixed "command 'pkg-version.checkVulnerabilities' not found" error
- Resolved issue with command registration for security vulnerability checking
- Improved build process to ensure all commands are properly registered

## [1.0.11] - 2025-04-20

### Fixed
- Fixed "command 'pkg-version.checkVulnerabilities' not found" error
- Resolved issue with command registration for security vulnerability checking
- Improved build process to ensure all commands are properly registered

## [1.0.10]

## [1.0.9] - 2025-04-19

### Fixed
- Fixed "Cannot find module 'axios'" error when running the packaged extension
- Improved build process to correctly bundle dependencies using esbuild

## [1.0.8] - 2025-04-19

### Changed
- Enhanced options menu UI with intuitive icons
- Improved menu organization with logical command grouping
- Better visual consistency throughout the extension interface

## [1.0.7] - 2025-04-19

### Added
- Custom pattern exclusion feature for more granular control over excluded files and folders
- Support for excluding specific files or deeper nested directories using glob patterns
- Added UI command in the Package Versions sidebar for easy access

## [1.0.6] - 2025-04-19

### Added
- Automatic exclusion of lock files (*.lock, package-lock.json, composer.lock, etc.)
- Added exclusion for common log and backup files (*.bak, *.backup, npm-debug.log, etc.)

## [1.0.3] - 2025-04-19

### Changed
- Major code refactoring for better maintainability
- Split monolithic codebase into modular components:
  - Separated dependency model into its own file
  - Created dedicated utilities for file operations, version comparison
  - Organized registry API fetchers into a single utilities file
  - Split parsers for different package managers into individual files
  - Created dedicated updaters for each package manager
- Improved error handling throughout the codebase
- Enhanced documentation with detailed module descriptions

### Fixed
- Various minor bugs in the dependency parsing logic
- Improved reliability of version comparison with complex version specifications

## [1.0.2] - 2025-04-19

### Added
- Support for Dart/Flutter pubspec.yaml files
- Ability to detect and parse Dart dependencies
- Update capability for pubspec.yaml dependencies

### Fixed
- Issue with nested vendor directories in Composer projects
- Bug in version comparison for pre-release versions

## [1.0.1] - 2025-14-19

### Added
- Support for Python requirements.txt files
- Status bar indicator showing number of outdated packages
- Bulk update feature to update all outdated packages at once

### Fixed
- Performance improvements for large repositories
- Better handling of version constraints in Composer

## [1.0.0] - 2025-14-10

### Added
- Initial release
- Support for package.json and composer.json files
- TreeView showing all detected dependencies
- Visual indicators for update types (major, minor, patch)
- Ability to update individual packages
- Folder exclusion functionality