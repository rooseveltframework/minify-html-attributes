## 1.1.3

- Added warnings for files that are skipped because they are not valid UTF-8 or are larger than `maxFileSize`.
- Changed JS so that it only follows names your HTML or CSS defines. A string assigned to some object's `id`, such as `user.id = 'admin'`, is no longer renamed.
- Changed `data-*` replacements to lowercase only. HTML attribute names ignore case, so once there were more than 26 of them, `data-a` and `data-A` collided and `element.dataset` stopped finding the uppercase ones.
- Changed `exemptStylesheets` to also keep every class and ID matched by a substring attribute selector in those stylesheets, like `[class^="col-"]`.
- Fixed implicit global variable renaming breaking JS:
  - Shorthand properties like `{ foo }` lost their key; they are now expanded to `{ foo: a }`.
  - `import.meta` and `new.target` were treated as variables.
  - A global declared in one script, or assigned with `window.foo =` or without a declaration, was mistaken for an element in another script or another inline `<script>`.
  - A renamed ID could become a reserved word such as `do`, the name of a global another script uses, a name the browser already defines, or a name the same file declares.
  - Browser globals like `name`, `status`, and `event` are now protected along with many more built-ins.
  - Class field values like `class A { el = foo }` were not followed.
- Fixed a variable holding a selector being traced when a parameter or another binding with the same name shadows it, or when it is reassigned through destructuring or a loop.
- Fixed a `//` comment containing an apostrophe in Less or Sass hiding the next selector from renaming.
- Fixed Sass `#{…}` and Less `@{…}` interpolation being read as part of a class name. Names sharing the visible part of an interpolated name now keep their spelling.
- Fixed Less and Sass `&-suffix` selectors breaking the parent rule. The parent class and every name built from it now keep their spelling.
- Fixed Less mixin calls like `.rounded;` failing to compile after the rule they call was renamed. Names called as mixins now keep their spelling.
- Fixed SVG `url(#id)` references in `fill`, `stroke`, `clip-path`, `mask`, `filter`, `marker-*`, and `style` attributes, and in stylesheets, not following a renamed ID.
- Fixed `[class^=…]`, `[class$=…]`, `[class*=…]`, and `[class|=…]` selectors (and their `id` equivalents) silently no longer matching. Every name they match now keeps its spelling.
- Fixed `[attr|=value]` being parsed as a namespaced attribute.
- Fixed byte order marks being removed from rewritten files.
- Fixed symbolic links to files and directories being skipped.
- Improved performance on pages with many `<script>` and `<style>` tags.
- Updated dependencies.

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
