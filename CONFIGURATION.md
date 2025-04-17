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

- `htmlDir` *[String]*: Location where your source HTML files are. If no HTML files are detected, this module will do nothing.
- `cssDir` *[String]*: Location where your source CSS files are. (Optional.)
- `jsDir` *[String]*: Location where your source JS files are. (Optional.)
- `extraAttributes` *[Array of Strings]*: Any additional HTML attributes you want to rename besides `class`, `id`, and `data-*`. Default `[]`.
- `exemptNames` *[Array of Strings]*: Any names you want exempt from renaming. Default `[]`.
- `disableClassReplacements` *[Boolean]*: Don't rename `class` attributes. Default: `false`.
- `disableIdReplacements` *[Boolean]*: Don't rename `id` attributes. Default: `false`.
- `disableDataReplacements` *[Boolean]*: Don't rename `data-*` attributes. Default: `false`.

The returned `editedFiles` object is structured as follows:

- Key: the relative path of the file that was edited.
  - `type` *[String]*: One of the following values: `html`, `css`, or `js`.
  - `contents` *[String]*: The edited code.
