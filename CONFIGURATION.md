## API

In the examples on the usage page, you can see that `minify-html-attributes` is called with the following params:

```javascript
const editedFiles = require('minify-html-attributes')({
  htmlDir: './mvc/.preprocessed_views', // where your html files to process are located
  cssDir: './.preprocessed_statics', // where your css files to process are located
  jsDir: './.preprocessed_statics' // where your js files to process are located
})
```

Here is a breakdown of all the available params:

### Directories

- `htmlDir` *[String]*: Location where your source HTML files are. If no HTML files are detected, this module will do nothing.
- `cssDir` *[String]*: Location where your source CSS files are. (Optional.)
- `jsDir` *[String]*: Location where your source JS files are. (Optional.)

The same directory may be given for more than one of these. Files are claimed by extension first, so a stylesheet sitting in your HTML directory is still read as a stylesheet.

### What gets renamed

- `renameAttributeValues` *[Array of Strings]*: Additional HTML attributes whose *values* should be renamed, the way `class` and `id` values are. Each attribute gets its own set of names, and the attribute name itself is left alone. Default `[]`.

  ```javascript
  renameAttributeValues: ['custom-attr'] // <p custom-attr="someName"> becomes <p custom-attr="a">
  ```
- `exemptNames` *[Array of Strings]*: Any names you want exempt from renaming. No other name will be given a replacement that collides with one of these. Default `[]`.
- `exemptStylesheets` *[Array of Strings]*: Paths to stylesheets, or directories of them, that this module is not allowed to edit. Typically a dependency theme you pull in with `@import` from `node_modules`. Every class and ID they define is added to `exemptNames`, so your markup keeps using the names those stylesheets expect. Default `[]`.

  ```javascript
  exemptStylesheets: ['node_modules/some-css-framework/dist/framework.css']
  ```
- `disableClassReplacements` *[Boolean]*: Don't rename `class` attributes. Default: `false`.
- `disableIdReplacements` *[Boolean]*: Don't rename `id` attributes. Default: `false`.
- `disableDataReplacements` *[Boolean]*: Don't rename `data-*` attributes. Default: `false`.
- `disableGlobalVariableReplacements` *[Boolean]*: Don't rename the implicit global variables browsers create for elements with an `id`. Only undeclared identifiers that match a real element ID are ever renamed, but set this if your JS reads globals that are defined by a script this module cannot see. Default: `false`.

### Which files get read

- `htmlExtensions` *[Array of Strings]*: Only read files with these extensions in `htmlDir` as HTML. By default every text file in `htmlDir` is read as HTML, which suits template directories where the files may have no extension at all.
- `cssExtensions` *[Array of Strings]*: Extensions to read as stylesheets. Default `['.css', '.less', '.scss']`.
- `jsExtensions` *[Array of Strings]*: Extensions to read as JavaScript. Default `['.js', '.mjs', '.cjs']`.
- `maxFileSize` *[Number]*: Skip files larger than this many bytes. Default `16777216` (16 MB).

Binary files, files that are not valid UTF-8, hidden files, and files inside hidden directories are always skipped.

### Reporting

- `onWarning` *[Function]*: Called with a string for each thing this module could not safely rename, and for each file it could not parse. Use it to surface these in your build output.

### The return value

The returned `editedFiles` object is structured as follows:

- Key: the path of the file that was edited.
  - `type` *[String]*: One of the following values: `html`, `css`, or `js`.
  - `contents` *[String]*: The edited code.

Files that were not modified are not included.

A summary of the last run is also available on the module itself, which is useful when debugging a build:

```javascript
const minifyHtmlAttributes = require('minify-html-attributes')
minifyHtmlAttributes({ /* … */ })

console.log(minifyHtmlAttributes.lastRun.nameMap) // { class: { … }, id: { … }, data: { … } }
console.log(minifyHtmlAttributes.lastRun.warnings) // array of strings
console.log(minifyHtmlAttributes.lastRun.fileCount) // how many files were read
```
