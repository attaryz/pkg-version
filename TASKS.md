# Development Tasks

This file tracks completed and planned tasks for the pkg-version extension.

## Completed Tasks

- [x] Refactor codebase into modular structure
- [x] Create separate model definition for Dependency class
- [x] Extract file utilities into a dedicated module
- [x] Create registry API fetchers for each package manager
- [x] Split parsers into separate files for each package manager
- [x] Create dedicated updaters for each package manager
- [x] Update README with new code structure documentation
- [x] Update CHANGELOG.md with refactoring details
- [x] Improve options menu UI with intuitive icons and better organization
- [x] Fix dependency bundling issue with axios module in packaged extension
- [x] Update itemName in readme.md

## Planned Tasks

- [ ] Add support for Cargo (Rust) dependencies
- [ ] Add support for Go modules
- [ ] Add support for Gradle/Maven (Java) dependencies
- [ ] Implement caching mechanism to reduce API calls
- [ ] Add offline mode for environments without internet access
- [ ] Improve performance for very large repositories
- [ ] Add batch update feature for specific dependency types (only patch, only minor)
- [ ] Create detailed documentation for each module
- [ ] Add unit tests for parsers
- [ ] Add unit tests for version comparison utilities
- [ ] Add integration tests for updaters

## Bugs/Issues to Address

- [ ] Improve error handling for API rate limiting
- [ ] Fix visual glitches in TreeView for deeply nested dependencies
- [ ] Address performance issues with large repositories
- [ ] Improve version constraint parsing for complex specifications

# Features

### Security Vulnerability Checking
- [ ] Research Snyk API integration options
- [ ] Implement Snyk API client
- [ ] Add vulnerability scanning functionality
- [ ] Design and implement vulnerability indicator UI
- [ ] Add configuration options for vulnerability checks

### Dependency Management Improvements
- [x] Implement separation of dependencies from dev-dependencies in the UI
- [ ] Create functionality to remove packages
- [ ] Add ability to lock or modify update constraints
- [ ] Implement hover functionality to display package info
- [ ] Create hover card with package summary

### Package Information Display
- [ ] Add option to display package info directly in VS Code
- [ ] Implement detection and display of deprecated packages
- [ ] Add runtime, package manager, and language info display
- [x] Create status counter for dependencies
- [ ] Research and implement alternatives suggestion system

### Package Search and Installation
- [ ] Design search interface for packages
- [ ] Implement package search functionality
- [ ] Add installation capability from search results
- [ ] Create UI for installation progress

## Bugs

### Folder Exclusion
- [x] Investigate why folder exclusion is not working
- [x] Fix folder exclusion functionality
- [x] Automatically exclude lock files and similar files
- [x] Add support for custom pattern exclusion at deeper levels
- [ ] Add tests for folder exclusion

## Implementation Priority
1. ~~Fix folder exclusion bug~~ (Completed in v1.0.6)
2. ~~Add automatic exclusion for lock files~~ (Completed in v1.0.6)
3. ~~Add custom pattern exclusion for more granular control~~ (Completed in v1.0.7)
4. Implement separation of dependencies from dev-dependencies
5. Add package removal functionality
6. Implement security vulnerability checking
7. Add package info on hover
8. Add deprecated packages indicator
9. Implement remaining features 