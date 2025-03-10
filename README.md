minify-html-attributes
#

[![Build Status](https://github.com/rooseveltframework/minify-html-attributes/workflows/CI/badge.svg
)](https://github.com/rooseveltframework/minify-html-attributes/actions?query=workflow%3ACI) [![npm](https://img.shields.io/npm/v/minify-html-attributes.svg)](https://www.npmjs.com/package/minify-html-attributes)

A Node.js module that will minify HTML attribute class names, IDs, and `data-*` attributes in a coordinated fashion across your HTML, CSS, and JS files. This is useful if you want to minify your code even more than standard minifiers do, or if you want to obfuscate your code and make it harder to read, reverse engineer, or repurpose.

This module is a pre-minifier that focuses only on HTML class names, IDs, and `data-*` attributes. It will not minify the rest of your code. As such, this tool should be run on your code *before* you run it through your standard minifier(s). You could do it in the opposite order if you like, but the outputs from this module will not be minified even if the inputs were.

This module was built and is maintained by the [Roosevelt web framework](https://github.com/rooseveltframework/roosevelt) [team](https://github.com/orgs/rooseveltframework/people), but it can be used independently of Roosevelt as well.

## Specific modifications

- This module renames:
  
  - `class` attribute values.
  - `id` attribute values.
  - `data-*` attribute names.
  - Any other attributes you specify using the `extraAttributes` param.

The new names will be renamed to the shortest possible value, e.g. `a`, `b`, `c`, etc.

- This module then updates:
  
  - In HTML files:
    - Attributes that reference any IDs that have been renamed. Attributes that reference IDs are: `for`, `form`, `headers`, `itemref`, `list`, `usemap`, `aria-activedescendant`, `aria-controls`, `aria-describedby`, `aria-labelledby`, and `aria-owns`.
    - Inline CSS code in `<style>` tags that references any renamed attributes.
    - Inline JS code in `<script>` tags that references any renamed attributes.
    - Inline JS code in event handler attributes like `onclick`, `onmouseover`, etc that references any renamed attributes.
  - In CSS files and inline CSS code:
    - Selectors that reference any renamed attributes.
    - CSS properties with `attr()` function calls that reference any renamed attributes.
    - CSS variables that store references to any renamed attributes.
  - In JS files and inline JS code:
    - JS code that references any renamed attributes.
    - Inline HTML in the JS that references any renamed attributes.
    - Inline CSS in the JS that references any renamed attributes.

### Caveats

This module works by running your HTML, CSS, and JS files through a series of parsers that generate abstract syntax trees of your code for analysis.

That means it will work best when:

- Your HTML code is either plain HTML or using a templating system that doesn't break the DOM parser.
- Your CSS code is either plain CSS or written in a CSS-compatible superset language that doesn't break the CSS parser.

For HTML and CSS those limitations shouldn't present a major problem in most web app architectures, but JavaScript is where things might get messy.

This module does its best to detect when you reference any classes, IDs, or `data-*` attributes in your JavaScript — including when you're doing this by assembling the reference from a series of variables — and will update the references accordingly. But there are probably edge cases this module doesn't handle yet.

For best results, simplify any DOM manipulation code you write that references classes, IDs, or `data-*` attributes as much as possible. If you find an edge case this module doesn't handle yet, file an issue, or better yet submit a pull request with a failing test for the scenario you would like to work. Or even better submit a PR with the code fix too!

## Usage

- Install this package from `npm` and include it in your Node.js-based build script.
- Copy all your source HTML, CSS, and JS files to a location of your choice that is safe for editing.
- Run them through `minify-html-attributes`. `minify-html-attributes` will return an object that is a list of files that it modified. Files that were not modified will not be included in the object.
- Update the copied files with the new changes.
- Run any additional minifiers you like against the modified files as normal.

### Sample app

Here's a full example that implements `minify-html-attributes` prior to running webpack and starting an Express server:

```javascript
const fs = require('fs-extra')

// copy all source html, css, and js to locations that are safe for editing
fs.copySync('mvc/views', 'mvc/.preprocessed_views') // copy unmodified html to a modified templates directory
fs.copySync('styles.css', '.preprocessed_statics/styles.css') // copy css file to the public folder
fs.copySync('browser.js', '.preprocessed_statics/browser.js') // copy css file to the public folder

// load minify-html-attributes
const editedFiles = require('minify-html-attributes')({
  htmlDir: './mvc/.preprocessed_views', // where your html files to process are located
  cssDir: './.preprocessed_statics', // where your css files to process are located
  jsDir: './.preprocessed_statics' // where your js files to process are located
})

// update any file that was postprocessed
for (const fileName in editedFiles) {
  const editedFile = editedFiles[fileName]
  fs.writeFileSync(fileName, editedFile.contents)
}

// copy preprocessed assets to final location

// html: no need for html files because they are edited in-place in ./mvc/.preprocessed_views

// css: just copy the file to the public folder; you could also do something fancier like run it through a preprocessor
fs.copySync('.preprocessed_statics/styles.css', 'public/styles.css') // copy css file to the public folder

// js: bundle preprocessed js after it is preprocessed
const webpack = require('webpack')
const path = require('path')
const webpackConfig = {
  mode: 'production',
  entry: './.preprocessed_statics/browser.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'public'),
    libraryTarget: 'umd'
  },
  devtool: 'source-map'
}
const compiler = webpack(webpackConfig)
compiler.run((err, stats) => {
  if (err || stats.hasErrors()) {
    console.error('Webpack build failed:', err || stats.toJson().errors)
  } else {
    // configure express
    const express = require('express')
    const app = express()
    app.use(require('body-parser').urlencoded({ extended: true })) // populates req.body on requests
    app.engine('html', require('teddy').__express) // set teddy as view engine that will load html files
    app.set('views', 'mvc/.preprocessed_views') // set template dir
    app.set('view engine', 'html') // set teddy as default view engine
    app.use(express.static('public')) // make public folder serve static files

    // load express routes
    require('./mvc/routes')(app)

    // start express server
    const port = 3000
    app.listen(port, () => {
      console.log(`🎧 express sample app server is running on http://localhost:${port}`)
    })
  }
})
```

Here's how to run the sample app:

- `cd sampleApps/express`
- `npm ci`
- `cd ../../`
- `npm run express-sample`
  - Or `npm run sample`
  - Or `cd` into `sampleApps/express` and run `npm ci` and `npm start`
- Go to [http://localhost:3000](http://localhost:3000)
  - The page with the web component is located at http://localhost:3000/pageWithForm

## API

In the example above, you can see that `minify-html-attributes` is called with the following params:

```javascript
const editedFiles = require('minify-html-attributes')({
  htmlDir: './mvc/.preprocessed_views', // where your html files to process are located
  cssDir: './.preprocessed_statics', // where your css files to process are located
  jsDir: './.preprocessed_statics' // where your js files to process are located
})
```

Here is a breakdown of all the available params:

- `htmlDir`: *[String]* Location where your source HTML files are. If no HTML files are detected, this module will do nothing.
- `cssDir`: *[String]* Location where your source CSS files are. (Optional.)
- `jsDir`: *[String]* Location where your source JS files are. (Optional.)
- `extraAttributes`: *[Array]* Any additional HTML attributes you want to rename besides `class`, `id`, and `data-*`. Default `[]`.
- `disableClassReplacements`: *[Boolean]* Don't rename `class` attributes. Default: `false`.
- `disableIdReplacements`: *[Boolean]* Don't rename `id` attributes. Default: `false`.
- `disableDataReplacements`: *[Boolean]* Don't rename `data-*` attributes. Default: `false`.

The returned `editedFiles` object is structured as follows:

- Key: the relative path of the file that was edited.
  
  - `type`: One of the following values: `html`, `css`, or `js`.
  
  - `contents`: The edited code.
