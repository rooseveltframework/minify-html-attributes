## 1.1.0

- Breaking: Renamed the `extraAttributes` param to `renameAttributeValues`, since it renames the attribute's value rather than its name. Passing the old name now does nothing.
- Added `onWarning` param, called for everything this module could not safely rename.
- Added `exemptStylesheets` param, for vendored stylesheets outside your `cssDir` that cannot be rewritten. Every name they define is exempted, so markup using a third party theme's classes keeps working.
- Added `htmlExtensions`, `cssExtensions`, `jsExtensions`, and `maxFileSize` params.
- Added `disableGlobalVariableReplacements` param.
- Added `minifyHtmlAttributes.lastRun` exposes the name map, warnings, and file count from the last run.
- Added support for Less and Sass stylesheets.
- Added better error handling.
- Changed `data-*` handling to rename the attribute name rather than its value, which is what the documentation always described. Values like `data-count="5"` are no longer corrupted.
- Fixed files containing non-ASCII character in their first 512 bytes being misdetected as binary and skipped entirely.
- Fixed various bugs with renaming selectors.
- Improved performance.
- Updated dependencies.

## 1.0.2

- Fixed a crash caused by not populating the `exemptNames` param.

## 1.0.1

- Added option to exempt specific values from being renamed.
- Fixed a bug that caused `name` attributes to be improperly renamed.

## 1.0.0

- Initial commit.
