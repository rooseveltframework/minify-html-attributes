const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { minifyHtml, runOnFixture } = require('../helpers')

describe('html attributes', () => {
  test('renames class and id values', () => {
    const output = minifyHtml('<p class="alpha" id="beta">hi</p>')
    assert.equal(output, '<p class="a" id="a">hi</p>')
  })

  test('renames every class in a list without inventing empty ones', () => {
    const output = minifyHtml('<p class="  alpha   beta  ">hi</p>')
    assert.equal(output, '<p class="  a   b  ">hi</p>')
  })

  test('renames data attribute names and leaves their values alone', () => {
    const output = minifyHtml('<p data-count="5" data-label="Some Text">hi</p>')
    assert.equal(output, '<p data-a="5" data-b="Some Text">hi</p>')
  })

  test('leaves the name attribute alone', () => {
    const output = minifyHtml('<input name="your_name" id="your_name">')
    assert.equal(output, '<input name="your_name" id="a">')
  })

  test('handles single quoted and unquoted attribute values', () => {
    assert.equal(minifyHtml("<p class='alpha'></p>"), "<p class='a'></p>")
    assert.equal(minifyHtml('<p class=alpha></p>'), '<p class=a></p>')
  })

  test('preserves everything it does not rename, byte for byte', () => {
    const source = '<!doctype html>\n<!-- a comment with class="alpha" -->\n<p\n  class="alpha"\n  title="Ünïcøde — ok 🚀"\n>text</p>\n'
    const output = minifyHtml(source)
    assert.equal(output, source.replace('\n  class="alpha"', '\n  class="a"'))
  })

  test('ignores markup inside comments and cdata', () => {
    const output = minifyHtml('<!-- <p class="ghost"></p> --><p class="real"></p>')
    assert.equal(output, '<!-- <p class="ghost"></p> --><p class="a"></p>')
  })

  test('leaves attribute values holding template syntax alone', () => {
    const source = '<p class="{dynamicClass}" id="{{handlebars}}"></p>'
    assert.equal(minifyHtml(source), source)
  })

  test('renames only the static classes in a mixed template value', () => {
    const output = minifyHtml('<p class="alpha {dynamic} beta"></p>')
    assert.equal(output, '<p class="a {dynamic} b"></p>')
  })

  test('does not treat unknown template elements as a problem', () => {
    const output = minifyHtml('<if something><p class="alpha">{variable}</p></if>')
    assert.equal(output, '<if something><p class="a">{variable}</p></if>')
  })
})

describe('id references in html', () => {
  test('follows for, form, list, and headers', () => {
    const { files } = runOnFixture({
      'html/page.html': '<label for="who">n</label><input id="who" form="theform" list="opts"><form id="theform"></form><datalist id="opts"></datalist><td headers="who opts">x</td>'
    })
    const output = files['html/page.html']
    assert.ok(output.includes('<label for="a">'))
    assert.ok(output.includes('id="a" form="b" list="c"'))
    assert.ok(output.includes('headers="a c"'))
  })

  test('follows aria attributes that reference ids', () => {
    const output = minifyHtml('<div id="panel"></div><button aria-controls="panel" aria-labelledby="panel">x</button>')
    assert.equal(output, '<div id="a"></div><button aria-controls="a" aria-labelledby="a">x</button>')
  })

  test('follows in-page fragment links', () => {
    const output = minifyHtml('<a href="#top">up</a><h1 id="top">t</h1>')
    assert.equal(output, '<a href="#a">up</a><h1 id="a">t</h1>')
  })

  test('leaves links that are not in-page fragments alone', () => {
    const source = '<a href="/somewhere#top">x</a><a href="https://example.com/#top">y</a><a href="#">z</a><h1 id="top">t</h1>'
    const output = minifyHtml(source)
    assert.ok(output.includes('href="/somewhere#top"'))
    assert.ok(output.includes('href="https://example.com/#top"'))
    assert.ok(output.includes('href="#"'))
    assert.ok(output.includes('id="a"'))
  })

  test('keeps usemap pointing at its map', () => {
    const output = minifyHtml('<img usemap="#chart"><map name="chart"><area></map>')
    assert.equal(output, '<img usemap="#a"><map name="a"><area></map>')
  })

  test('does not invent an id for a reference that has no target', () => {
    const source = '<label for="nothing">n</label>'
    assert.equal(minifyHtml(source), source)
  })
})

describe('embedded css and js in html', () => {
  test('renames selectors inside a style tag', () => {
    const output = minifyHtml('<style>.alpha { color: red }</style><p class="alpha"></p>')
    assert.equal(output, '<style>.a { color: red }</style><p class="a"></p>')
  })

  test('renames selectors inside a script tag', () => {
    const output = minifyHtml('<p id="alpha"></p><script>document.querySelector("#alpha")</script>')
    assert.equal(output, '<p id="a"></p><script>document.querySelector("#a")</script>')
  })

  test('uses names discovered in later files, not just earlier ones', () => {
    // the inline script mentions a class that only appears in a stylesheet processed afterwards; a single pass implementation would miss it
    const { files } = runOnFixture({
      'html/page.html': '<script>document.querySelector(".fromCss")</script>',
      'css/styles.css': '.fromCss { color: red }'
    })
    assert.equal(files['html/page.html'], '<script>document.querySelector(".a")</script>')
    assert.equal(files['css/styles.css'], '.a { color: red }')
  })

  test('leaves non-javascript script tags alone', () => {
    const source = '<script type="application/json">{"class": "alpha"}</script><p class="alpha"></p>'
    const output = minifyHtml(source)
    assert.ok(output.includes('{"class": "alpha"}'))
    assert.ok(output.includes('class="a"'))
  })

  test('treats html template script tags as markup', () => {
    const output = minifyHtml('<script type="text/template"><p class="alpha"></p></script><i class="alpha"></i>')
    assert.equal(output, '<script type="text/template"><p class="a"></p></script><i class="a"></i>')
  })

  test('rewrites inline event handlers', () => {
    const output = minifyHtml('<p id="alpha"></p><button onclick="document.getElementById(\'alpha\').remove()">x</button>')
    assert.ok(output.includes("document.getElementById('a')"))
  })

  test('leaves event handlers containing entities alone and says so', () => {
    const { files, warnings } = runOnFixture({
      'html/page.html': '<p id="alpha"></p><button onclick="f(&quot;alpha&quot;)">x</button>'
    })
    assert.ok(files['html/page.html'].includes('f(&quot;alpha&quot;)'))
    assert.ok(warnings.some(warning => warning.includes('html entities')))
  })

  test('does not read the contents of a textarea as markup', () => {
    const source = '<textarea><p class="ghost"></p></textarea><p class="real"></p>'
    const output = minifyHtml(source)
    assert.ok(output.includes('<p class="ghost"></p></textarea>'))
    assert.ok(output.includes('<p class="a"></p>'))
  })
})
