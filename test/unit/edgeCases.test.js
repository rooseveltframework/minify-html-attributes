const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { minifyHtml, minifyCss, runOnFixture } = require('../helpers')

// real apps contain malformed and unusual input. none of it should make the minifier throw, and none of it should be corrupted on the way through.

describe('unusual css', () => {
  test('escaped quotes inside a declaration string', () => {
    const source = '.alpha::after { content: "a \\" .beta quote" }'
    assert.equal(minifyCss(source), '.a::after { content: "a \\" .beta quote" }')
  })

  test('an unterminated string does not swallow the rest of the file', () => {
    const source = '.alpha { content: "unterminated'
    assert.equal(minifyCss(source), '.a { content: "unterminated')
  })

  test('braces inside a data uri are not mistaken for a rule body', () => {
    const source = '.alpha { background: url("data:image/svg+xml;utf8,<svg>{}</svg>") }\n.beta { color: red }'
    assert.equal(minifyCss(source), '.a { background: url("data:image/svg+xml;utf8,<svg>{}</svg>") }\n.b { color: red }')
  })

  test('nested parentheses in a value', () => {
    const source = '.alpha { width: calc(100% - (2 * var(--gap))) }\n.beta { color: red }'
    assert.equal(minifyCss(source), '.a { width: calc(100% - (2 * var(--gap))) }\n.b { color: red }')
  })

  test('an unclosed block', () => {
    assert.equal(minifyCss('.alpha { color: red'), '.a { color: red')
  })

  test('an unclosed comment', () => {
    const source = '.alpha { color: red }\n/* never closed .beta'
    assert.equal(minifyCss(source), '.a { color: red }\n/* never closed .beta')
  })

  test('an unclosed parenthesis', () => {
    assert.equal(minifyCss('.alpha { width: calc(100%'), '.a { width: calc(100%')
  })

  test('an empty stylesheet', () => {
    assert.equal(minifyCss(''), '')
  })

  test('an unterminated attribute selector', () => {
    assert.equal(minifyCss('[data-alpha'), '[data-alpha')
  })
})

describe('unusual html', () => {
  test('a cdata section is skipped', () => {
    const source = '<![CDATA[ <p class="ghost"></p> ]]><p class="real"></p>'
    assert.equal(minifyHtml(source), '<![CDATA[ <p class="ghost"></p> ]]><p class="a"></p>')
  })

  test('a processing instruction is skipped', () => {
    const source = '<?xml version="1.0"?><p class="alpha"></p>'
    assert.equal(minifyHtml(source), '<?xml version="1.0"?><p class="a"></p>')
  })

  test('a bare less-than sign is not a tag', () => {
    const source = 'a < b and c > d <p class="alpha"></p>'
    assert.equal(minifyHtml(source), 'a < b and c > d <p class="a"></p>')
  })

  test('an unterminated attribute value', () => {
    const source = '<p class="alpha'
    assert.equal(minifyHtml(source), '<p class="a')
  })

  test('an unclosed script tag', () => {
    const source = '<p id="alpha"></p><script>document.getElementById("alpha")'
    assert.equal(minifyHtml(source), '<p id="a"></p><script>document.getElementById("a")')
  })

  test('an unclosed comment', () => {
    const source = '<p class="alpha"></p><!-- never closed'
    assert.equal(minifyHtml(source), '<p class="a"></p><!-- never closed')
  })

  test('valueless attributes and odd spacing', () => {
    const source = '<input disabled   class = "alpha"   hidden>'
    assert.equal(minifyHtml(source), '<input disabled   class = "a"   hidden>')
  })

  test('a self closing tag', () => {
    assert.equal(minifyHtml('<img class="alpha" />'), '<img class="a" />')
  })

  test('an empty document', () => {
    assert.equal(minifyHtml(''), '')
  })

  test('a broken inline script is reported and the rest of the page still processed', () => {
    const { files, warnings } = runOnFixture({
      'html/page.html': '<p class="alpha"></p><script>function ( { broken</script>'
    })
    assert.ok(files['html/page.html'].includes('class="a"'))
    assert.ok(files['html/page.html'].includes('function ( { broken'))
    assert.ok(warnings.some(warning => warning.includes('inline script')))
  })

  test('a broken inline event handler is reported', () => {
    const { warnings } = runOnFixture({ 'html/page.html': '<button onclick="if ( {">x</button>' })
    assert.ok(warnings.some(warning => warning.includes('onclick handler')))
  })
})

describe('unusual javascript', () => {
  function withPage (js, html = '<p id="alpha" class="beta" data-gamma="1" custom-attr="delta"></p>', params = {}) {
    const { files, warnings } = runOnFixture({ 'html/page.html': html, 'js/script.js': js }, params)
    return { js: files['js/script.js'], warnings }
  }

  test('document.write is treated as markup', () => {
    assert.equal(withPage('document.write(\'<p class="beta"></p>\')').js, 'document.write(\'<p class="a"></p>\')')
  })

  test('class and id attribute selectors inside a query', () => {
    const output = withPage('document.querySelector(\'[class~="beta"][id="alpha"]\')').js
    assert.equal(output, 'document.querySelector(\'[class~="a"][id="a"]\')')
  })

  test('an extra attribute inside a query selector', () => {
    const output = withPage('document.querySelector(\'[custom-attr="delta"]\')', undefined, { renameAttributeValues: ['custom-attr'] }).js
    assert.equal(output, 'document.querySelector(\'[custom-attr="a"]\')')
  })

  test('a name split across a concatenation is left alone and reported', () => {
    const source = "document.querySelector('.be' + 'ta')"
    const { js, warnings } = withPage(source)
    assert.equal(js, source)
    assert.ok(warnings.some(warning => warning.includes('more than one expression')))
  })

  test('a constructed stylesheet', () => {
    assert.equal(withPage("sheet.replaceSync('.beta { color: red }')").js, "sheet.replaceSync('.a { color: red }')")
  })

  test('classList.replace is not mistaken for a stylesheet method', () => {
    assert.equal(withPage("el.classList.replace('beta', 'other')", '<p class="beta other"></p>').js, "el.classList.replace('a', 'b')")
  })

  test('a computed dataset key that is not a literal is left alone', () => {
    const source = 'el.dataset[whichever]'
    assert.equal(withPage(source).js, source)
  })

  test('a selector built from a chain too deep to follow is left alone', () => {
    const source = "const a1 = 'beta'\nconst a2 = a1\nconst a3 = a2\nconst a4 = a3\nconst a5 = a4\nconst a6 = a5\ndocument.querySelector('.' + a6)"
    assert.equal(withPage(source).js, source)
  })

  test('a non-string argument is not mistaken for a selector', () => {
    const source = 'document.querySelector(42)\ndocument.getElementById(null)\nel.classList.add(...names)'
    assert.equal(withPage(source).js, source)
  })

  test('a call with no arguments at all', () => {
    const source = 'document.querySelector()\nel.classList.add()'
    assert.equal(withPage(source).js, source)
  })

  test('a computed member call is not treated as a dom api', () => {
    const source = "el['querySelector']('.beta')"
    assert.equal(withPage(source).js, source)
  })

  test('an empty file', () => {
    assert.equal(withPage('').js, '')
  })
})

describe('names that are only partly visible', () => {
  function withPage (js, html = '<p id="alpha" class="beta"></p><p class="keep alsoKeep"></p>') {
    const { files, warnings } = runOnFixture({ 'html/page.html': html, 'js/script.js': js })
    return { js: files['js/script.js'], warnings }
  }

  test('an id built from a runtime value is left alone entirely', () => {
    // renaming just the literal half would produce an id nothing else refers to
    const source = "const copied = el.id\nel.id = copied + '_suffix'"
    const { js, warnings } = withPage(source)
    assert.equal(js, source)
    assert.ok(warnings.some(warning => warning.includes('only known at runtime')))
  })

  test('a class name with a runtime prefix or suffix is left alone', () => {
    const source = "document.querySelector('.beta' + suffix)\ndocument.querySelector('.' + prefix + 'beta')"
    assert.equal(withPage(source).js, source)
  })

  test('complete class names either side of a runtime value are still renamed', () => {
    const output = withPage("el.className = 'keep ' + dynamic + ' alsoKeep'").js
    assert.equal(output, "el.className = 'a ' + dynamic + ' b'")
  })

  test('a wholly dynamic class name is left alone without complaint', () => {
    const source = 'el.classList.add(whicheverClass)'
    const { js, warnings } = withPage(source)
    assert.equal(js, source)
    assert.deepEqual(warnings, [])
  })

  test('an attribute name built from a runtime value is left alone', () => {
    const source = "el.getAttribute('data-' + which)"
    assert.equal(withPage(source, '<p data-thing="1"></p>').js, source)
  })
})
