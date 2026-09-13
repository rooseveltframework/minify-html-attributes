const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { runOnFixture } = require('../helpers')

// runs a snippet of js alongside a page that declares the names it references, so the minifier has real mappings to work with
function withPage (js, html = '<p id="alpha" class="beta" data-gamma="1"></p>', params) {
  const { files, warnings, nameMap } = runOnFixture({ 'html/page.html': html, 'js/script.js': js }, params)
  return { js: files['js/script.js'], html: files['html/page.html'], warnings, nameMap }
}

describe('selector strings in javascript', () => {
  test('renames classes and ids in querySelector', () => {
    assert.equal(withPage("document.querySelector('#alpha .beta')").js, "document.querySelector('#a .a')")
  })

  test('renames data attribute names in attribute selectors', () => {
    assert.equal(withPage("document.querySelectorAll('input[data-gamma], button[data-gamma]')").js, "document.querySelectorAll('input[data-a], button[data-a]')")
  })

  test('leaves element names in selectors alone', () => {
    const source = "document.querySelector('main article')"
    assert.equal(withPage(source, '<main id="main"></main><article class="article"></article>').js, source)
  })

  test('leaves other attribute selectors alone', () => {
    const source = "document.querySelectorAll('select[name=\"alpha\"]')"
    assert.equal(withPage(source).js, source)
  })

  test('handles closest and matches', () => {
    assert.equal(withPage("el.closest('.beta'); el.matches('#alpha')").js, "el.closest('.a'); el.matches('#a')")
  })

  test('resolves a selector built from a template literal', () => {
    // eslint-disable-next-line no-template-curly-in-string -- these are javascript samples, not templates
    const source = "const id = 'alpha'\ndocument.querySelector(`#${id}`)"
    // eslint-disable-next-line no-template-curly-in-string
    assert.equal(withPage(source).js, "const id = 'a'\ndocument.querySelector(`#${id}`)")
  })

  test('resolves a selector built by concatenation', () => {
    const output = withPage("const name = 'beta'\ndocument.querySelector('.' + name)").js
    assert.equal(output, "const name = 'a'\ndocument.querySelector('.' + name)")
  })

  test('resolves an attribute selector built from several pieces', () => {
    // eslint-disable-next-line no-template-curly-in-string -- these are javascript samples, not templates
    const source = "const prefix = 'data-'\nconst attribute = 'gamma'\ndocument.querySelector(`[${prefix}${attribute}]`)"
    // eslint-disable-next-line no-template-curly-in-string
    assert.equal(withPage(source).js, "const prefix = 'data-'\nconst attribute = 'a'\ndocument.querySelector(`[${prefix}${attribute}]`)")
  })

  test('leaves a variable alone when it is reassigned and so cannot be traced', () => {
    const source = "let name = 'beta'\nname = somethingElse\ndocument.querySelector('.' + name)"
    assert.equal(withPage(source).js, source)
  })

  test('handles both branches of a conditional selector', () => {
    const output = withPage("document.querySelector(flag ? '#alpha' : '.beta')").js
    assert.equal(output, "document.querySelector(flag ? '#a' : '.a')")
  })
})

describe('dom apis in javascript', () => {
  test('getElementById and getElementsByClassName', () => {
    assert.equal(withPage("document.getElementById('alpha'); document.getElementsByClassName('beta')").js, "document.getElementById('a'); document.getElementsByClassName('a')")
  })

  test('classList methods', () => {
    const output = withPage("el.classList.add('beta'); el.classList.remove('beta'); el.classList.toggle('beta', force); el.classList.contains('beta')").js
    assert.equal(output, "el.classList.add('a'); el.classList.remove('a'); el.classList.toggle('a', force); el.classList.contains('a')")
  })

  test('className assignment, including a list of classes', () => {
    const output = withPage("el.className = 'beta other'", '<p class="beta other"></p>').js
    assert.equal(output, "el.className = 'a b'")
  })

  test('id assignment', () => {
    assert.equal(withPage("el.id = 'alpha'").js, "el.id = 'a'")
  })

  test('data attribute names passed to getAttribute and friends', () => {
    const output = withPage("el.getAttribute('data-gamma'); el.removeAttribute('data-gamma'); el.hasAttribute('data-gamma')").js
    assert.equal(output, "el.getAttribute('data-a'); el.removeAttribute('data-a'); el.hasAttribute('data-a')")
  })

  test('setAttribute rewrites class and id values as well as data names', () => {
    const output = withPage("el.setAttribute('class', 'beta'); el.setAttribute('id', 'alpha'); el.setAttribute('data-gamma', 'untouched')").js
    assert.equal(output, "el.setAttribute('class', 'a'); el.setAttribute('id', 'a'); el.setAttribute('data-a', 'untouched')")
  })

  test('leaves attribute names it does not own alone', () => {
    const source = "el.setAttribute('hidden', 'hidden'); el.getAttribute('title'); el.removeAttribute('open')"
    assert.equal(withPage(source).js, source)
  })

  test('dataset properties, in camel case and bracketed', () => {
    const html = '<p data-underline-this="1"></p>'
    assert.equal(withPage('el.dataset.underlineThis', html).js, 'el.dataset.a')
    assert.equal(withPage("el.dataset['underline-this']", html).js, "el.dataset['a']")
  })

  test('document.forms indexed by id', () => {
    const html = '<form id="myform"></form>'
    assert.equal(withPage('document.forms.myform', html).js, 'document.forms.a')
    assert.equal(withPage("document.forms['myform']", html).js, "document.forms['a']")
  })

  test('markup passed to insertAdjacentHTML and innerHTML', () => {
    const output = withPage("el.insertAdjacentHTML('beforeend', '<span class=\"beta\">x</span>'); el.innerHTML = '<i id=\"alpha\"></i>'").js
    assert.equal(output, "el.insertAdjacentHTML('beforeend', '<span class=\"a\">x</span>'); el.innerHTML = '<i id=\"a\"></i>'")
  })

  test('markup assembled by concatenation', () => {
    const output = withPage("el.insertAdjacentHTML('beforeend', '<span class=\"beta\">' + text + '</span>')").js
    assert.equal(output, "el.insertAdjacentHTML('beforeend', '<span class=\"a\">' + text + '</span>')")
  })

  test('stylesheet rules inserted from javascript', () => {
    assert.equal(withPage("sheet.insertRule('.beta { color: red }')").js, "sheet.insertRule('.a { color: red }')")
  })

  test('an id used as an implicit global variable', () => {
    const output = withPage("if (typeof alpha !== 'undefined') console.log(alpha)").js
    assert.equal(output, "if (typeof a !== 'undefined') console.log(a)")
  })
})

describe('javascript the minifier must not touch', () => {
  test('module paths that happen to match a class name', () => {
    const source = "require('widgets/beta')\nimport thing from './alpha.js'"
    assert.equal(withPage(source).js, source)
  })

  test('variables, parameters, and properties that share a name with an element', () => {
    const source = 'const beta = 1\nfunction f (alpha) { return alpha + beta }\nconst o = { alpha: 1, beta: 2 }\no.alpha = o.beta'
    assert.equal(withPage(source).js, source)
  })

  test('a method named like an element', () => {
    const source = 'const cookies = { alpha: function (name) { return name } }\ncookies.alpha("x")'
    assert.equal(withPage(source).js, source)
  })

  test('strings that are not selectors', () => {
    const source = "window.matchMedia('(prefers-color-scheme: dark)')\ncookie.set('alpha', 'beta', 4017)\nconsole.log('Switch to the beta theme')\nfetch('/api/alpha')"
    assert.equal(withPage(source).js, source)
  })

  test('json shaped strings are not read as css', () => {
    const source = 'el.textContent = \'{"alpha": "beta"}\''
    assert.equal(withPage(source).js, source)
  })

  test('protected globals, even when an element claims the name', () => {
    const source = 'module.exports = document.location'
    assert.equal(withPage(source, '<p id="module"></p><p id="document"></p>').js, source)
  })

  test('comments, formatting, and unicode survive untouched', () => {
    const source = '/* global p, Image */\n// a comment mentioning .beta\nconst emoji = "🚀 launch…"\n\nel.classList.add(\'beta\')\n'
    const output = withPage(source).js
    assert.equal(output, source.replace("add('beta')", "add('a')"))
  })

  test('a global rename is skipped when it would collide with a local name', () => {
    // `alpha` is the only id so it becomes `a`, but this file already binds `a`
    const source = 'const a = 1\nconsole.log(alpha, a)'
    const { js, warnings } = withPage(source)
    assert.equal(js, source)
    assert.ok(warnings.some(warning => warning.includes('already used')))
  })
})

describe('modern javascript', () => {
  const cases = {
    'es modules': "import { thing } from './x.js'\nexport default thing",
    'class fields and private members': 'class A { #x = 1; static y = 2; static { this.z = 3 } get v () { return this.#x } }',
    'optional chaining and nullish coalescing': 'const v = a?.b?.[c] ?? d',
    'async generators and for await': 'async function * g () { for await (const x of y) yield x }',
    'a hashbang': '#!/usr/bin/env node\nconsole.log(1)',
    'top level await': "const x = await fetch('/')"
  }

  for (const [label, source] of Object.entries(cases)) {
    test(`parses ${label} without complaint`, () => {
      const { js, warnings } = withPage(source)
      assert.equal(js, source)
      assert.deepEqual(warnings, [])
    })
  }

  test('reports a file it cannot parse instead of throwing', () => {
    const { files, warnings } = runOnFixture({ 'js/broken.js': 'function ( { this is not javascript' })
    assert.equal(files['js/broken.js'], 'function ( { this is not javascript', 'the file must be left exactly as it was')
    assert.ok(warnings.some(warning => warning.includes('could not be parsed')))
  })
})
