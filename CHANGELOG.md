# Change Log

All notable changes to the "pkg-version" extension will be documented in this file.

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