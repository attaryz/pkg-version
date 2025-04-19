# Change Log

All notable changes to the "pkg-version" extension will be documented in this file.

## [1.0.9] - 2024-07-11

### Fixed
- Fixed "Cannot find module 'axios'" error when running the packaged extension
- Improved build process to correctly bundle dependencies using esbuild

## [1.0.8] - 2024-07-10

### Changed
- Enhanced options menu UI with intuitive icons
- Improved menu organization with logical command grouping
- Better visual consistency throughout the extension interface

## [1.0.7] - 2024-07-09

### Added
- Custom pattern exclusion feature for more granular control over excluded files and folders
- Support for excluding specific files or deeper nested directories using glob patterns
- Added UI command in the Package Versions sidebar for easy access

## [1.0.6] - 2024-06-27

### Added
- Automatic exclusion of lock files (*.lock, package-lock.json, composer.lock, etc.)
- Added exclusion for common log and backup files (*.bak, *.backup, npm-debug.log, etc.)

## [1.3.0] - 2024-04-19

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

## [1.2.0] - 2024-02-15

### Added
- Support for Dart/Flutter pubspec.yaml files
- Ability to detect and parse Dart dependencies
- Update capability for pubspec.yaml dependencies

### Fixed
- Issue with nested vendor directories in Composer projects
- Bug in version comparison for pre-release versions

## [1.1.0] - 2023-12-10

### Added
- Support for Python requirements.txt files
- Status bar indicator showing number of outdated packages
- Bulk update feature to update all outdated packages at once

### Fixed
- Performance improvements for large repositories
- Better handling of version constraints in Composer

## [1.0.0] - 2023-10-01

### Added
- Initial release
- Support for package.json and composer.json files
- TreeView showing all detected dependencies
- Visual indicators for update types (major, minor, patch)
- Ability to update individual packages
- Folder exclusion functionality 