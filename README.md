💫 **minify-html-attributes** [![npm](https://img.shields.io/npm/v/minify-html-attributes.svg)](https://www.npmjs.com/package/minify-html-attributes)

A Node.js module that will minify HTML attribute class names, IDs, and `data-*` attributes in a coordinated fashion across your HTML, CSS, and JS files. This is useful if you want to minify your code even more than standard minifiers do, or if you want to obfuscate your code and make it harder to read, reverse engineer, or repurpose.

This module is a pre-minifier that focuses only on HTML class names, IDs, and `data-*` attributes. It will not minify the rest of your code. As such, this tool should be run on your code *before* you run it through your standard minifier(s). You could do it in the opposite order if you like, but the outputs from this module will not be minified even if the inputs were.

This module was built and is maintained by the [Roosevelt web framework](https://rooseveltframework.org) [team](https://rooseveltframework.org/contributors), but it can be used independently of Roosevelt as well.

<details open>
  <summary>Documentation</summary>
  <ul>
    <li><a href="./USAGE.md">Usage</a></li>
    <li><a href="./CONFIGURATION.md">CONFIGURATION</a></li>
  </ul>
</details>

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
