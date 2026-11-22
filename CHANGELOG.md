## 1.1.2

- Added `exemptScripts` param, the counterpart of `exemptStylesheets` for scripts this module is not handed, such as a library bundled in from `node_modules`.
- Added `idReferenceAttributes` param, for attributes whose value is an ID that a library defines. Their values are renamed along with the IDs they point at.
- Added warnings for class values this module has to leave alone because a template builds them, such as `class="flash {type}"`, and for class attributes a template writes from inside another attribute. Either stops matching a renamed class in your CSS or JS without any error, so they are reported through `onWarning` whenever a class is renamed.
- Fixed `popovertarget`, `commandfor`, and `interestfor` not following a renamed ID, which broke popovers and invoker buttons, and `<output for>` only following the first of the IDs it lists.
- Updated dependencies.

## 1.1.1

- Fixed `CHANGELOG.md`, `CONFIGURATION.md`, and `USAGE.md` being omitted from the published npm package.

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
