💫 **minify-html-attributes** [![npm](https://img.shields.io/npm/v/minify-html-attributes.svg)](https://www.npmjs.com/package/minify-html-attributes)

A Node.js module that will minify HTML attribute class names, IDs, and `data-*` attributes in a coordinated fashion across your HTML, CSS, and JS files. This is useful if you want to minify your code even more than standard minifiers do, or if you want to obfuscate your code and make it harder to read, reverse engineer, or repurpose.

This module is a pre-minifier that focuses only on HTML class names, IDs, and `data-*` attributes. It will not minify the rest of your code. As such, this tool should be run on your code *before* you run it through your standard minifier(s). You could do it in the opposite order if you like, but the outputs from this module will not be minified even if the inputs were.

This module was built and is maintained by the [Roosevelt web framework](https://rooseveltframework.org) [team](https://rooseveltframework.org/contributors), but it can be used independently of Roosevelt as well.

<details open>
  <summary>Documentation</summary>
  <ul>
    <li><a href="./USAGE.md">Usage</a></li>
    <li><a href="./CONFIGURATION.md">Configuration</a></li>
  </ul>
</details>

## Specific modifications

- This module renames:

  - `class` attribute values.
  - `id` attribute values.
  - `data-*` attribute names.
  - The values of any other attributes you list in the `renameAttributeValues` param, the way `class` and `id` values are renamed. Those attributes' names are left alone.

The new names will be renamed to the shortest possible value, e.g. `a`, `b`, `c`, etc. Names are handed out in descending order of how often each one appears, so the names you use most get the shortest replacements.

- This module then updates:

  - In HTML files:
    - Attributes that reference any IDs that have been renamed. Attributes that reference IDs are: `for` (a list of IDs on `<output>`), `form`, `headers`, `itemref`, `list`, `usemap`, `popovertarget`, `commandfor`, `interestfor`, `aria-activedescendant`, `aria-controls`, `aria-describedby`, `aria-details`, `aria-errormessage`, `aria-flowto`, `aria-labelledby`, `aria-owns`, and any you list in the `idReferenceAttributes` param, such as a library's `data-for`.
    - In-page fragment links, e.g. `<a href="#someId">`. Links that point anywhere else are left alone.
    - `<map name>`, so that `usemap` keeps pointing at the right image map.
    - Inline CSS code in `<style>` tags that references any renamed attributes.
    - Inline JS code in `<script>` tags that references any renamed attributes.
    - Markup in `<script type="text/template">` tags and similar.
    - Inline JS code in event handler attributes like `onclick`, `onmouseover`, etc that references any renamed attributes.
    - SVG `url(#someId)` references in `fill`, `stroke`, `clip-path`, `mask`, `filter`, `marker-start`, `marker-mid`, `marker-end`, and `style` attributes.
  - In CSS files and inline CSS code:
    - Class and ID selectors, including inside functional pseudo-classes like `:not()`, `:is()`, and `:has()`.
    - Attribute selectors: `[data-*]` attribute names, and the values in `[class="…"]`, `[class~="…"]`, `[id="…"]`, and any `renameAttributeValues` attributes you configured.
    - Selectors reached through `@extend`.
    - `url(#someId)` references to renamed IDs.
  - In JS files and inline JS code:
    - Selector strings passed to `querySelector`, `querySelectorAll`, `closest`, and `matches`.
    - `getElementById` and `getElementsByClassName` arguments.
    - `classList.add`, `.remove`, `.toggle`, `.contains`, and `.replace` arguments.
    - `className` and `classList.value` assignments.
    - `id` assignments.
    - `data-*` attribute names passed to `getAttribute`, `setAttribute`, `removeAttribute`, `hasAttribute`, and `toggleAttribute`, plus the `class` and `id` values passed to `setAttribute`.
    - `element.dataset.someName` and `element.dataset['some-name']`.
    - `document.forms.someFormId`.
    - Inline HTML in the JS assigned to `innerHTML` or `outerHTML`, or passed to `insertAdjacentHTML` or `document.write`.
    - Inline CSS in the JS passed to `CSSStyleSheet.replaceSync` or `insertRule`.
    - The implicit global variables browsers create for elements with an `id`.
    - Any of the above assembled out of template literals, string concatenation, or a variable holding a string literal.

  JS only ever follows names your HTML or CSS defines. A name that only appears in JS is left alone.

### Caveats

The renames this module can make are limited to the references it can actually see. In particular:

- **Names assembled at runtime cannot be followed.** If your code does `element.id = prefix + suffix` or your template writes `class="{someVariable}"`, this module has no way to know what the resulting name will be, so it leaves it alone. Values containing template syntax are skipped rather than guessed at. The same goes for a class attribute a template writes from inside another attribute. Both are reported through `onWarning` whenever any class is renamed, since a class they produce would no longer match a renamed one in your CSS or JS.
- **JS strings are only rewritten where the context proves they are selectors.** A string that merely happens to match a class name like a module path, a cookie name, a sentence, a media query is left alone.
- **Stylesheets outside your `cssDir` are not renamed.** If you `@import` a third party stylesheet from `node_modules`, the class names it defines cannot be renamed in it, while your HTML using those classes would be. Point the `exemptStylesheets` param at those files and every name they define is left alone on your side of the fence too.
- **Scripts outside your `jsDir` are not renamed either.** A library bundled in from `node_modules` may look up its own class names or read `data-*` attributes from your markup, and it would stop finding them once your markup was renamed. Point the `exemptScripts` param at its files and every class, ID, and `data-*` name it uses is left alone.
- **Preprocessor selectors built with `&` or interpolation cannot be renamed.** In Less and Sass, `.block { &-element { … } }` produces a `.block-element` class that never appears literally in your source. This module warns when it sees this pattern and keeps both `block` and `block-element` at their original spelling. Interpolated names like `.icon-#{$name}` work the same way: every class starting with `icon-` keeps its spelling.
- **Less and Sass mixins are left alone**, since `.mixin()` is a function call rather than a selector. A rule called as a mixin, like `.rounded;`, keeps its name everywhere.
- **Substring attribute selectors are left alone.** `[data-x^="foo"]` has to keep matching every value that starts with `foo`, and this module cannot know what those are. The attribute name is still renamed; the value is not. For `class` and `id`, as in `[class^="col-"]`, every class or ID the selector matches keeps its spelling instead.
- **The indented Sass syntax (`.sass`) is not supported**, only the braced dialects.

When this module cannot safely rename something, it says so rather than guessing. Pass an `onWarning` callback to hear about it.

If you find an edge case this module doesn't handle yet, file an issue, or better yet submit a pull request with a failing test for the scenario you would like to work. Or even better submit a PR with the code fix too!
