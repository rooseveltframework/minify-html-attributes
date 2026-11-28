const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const minifyHtmlAttributes = require('../../minify-html-attributes')
const { runOnFixture, minifyHtml, minifyCss } = require('../helpers')
const { NameRegistry } = require('../../lib/names')
const { listFiles, readTextFile } = require('../../lib/files')

// each of these once produced output that broke the page it was run on

describe('data-* replacements', () => {
  test('are always lowercase, since html attribute names ignore case', () => {
    const html = Array.from({ length: 60 }, (_, index) => `<i data-k${index}="1"></i>`).join('')
    const { nameMap } = runOnFixture({ 'html/page.html': html })
    const replacements = Object.values(nameMap.data)
    assert.equal(replacements.length, 60)
    assert.ok(replacements.every(name => name === name.toLowerCase()))
    assert.equal(new Set(replacements).size, 60)
  })

  test('dataset access keeps working past the first 26 names', () => {
    const html = Array.from({ length: 30 }, (_, index) => `<i data-k${index}="1"></i>`).join('')
    const { files, nameMap } = runOnFixture({ 'html/page.html': html, 'js/script.js': 'el.dataset.k28' })
    assert.equal(files['js/script.js'], `el.dataset.${nameMap.data.k28}`)
    assert.match(nameMap.data.k28, /^[a-z]+$/)
  })
})

describe('the name registry', () => {
  test('excluded names keep their spelling and are never handed out', () => {
    const registry = new NameRegistry()
    registry.observe('class', 'a')
    registry.observe('class', 'other')
    registry.exclude('class', 'a')
    registry.assign()
    assert.equal(registry.get('class', 'a'), null)
    assert.equal(registry.get('class', 'other'), 'b')
  })

  test('reserved spellings are skipped only in their own namespace', () => {
    const registry = new NameRegistry()
    registry.observe('id', 'x')
    registry.observe('class', 'y')
    registry.reserve('id', ['a'])
    registry.assign()
    assert.equal(registry.get('id', 'x'), 'b')
    assert.equal(registry.get('class', 'y'), 'a')
  })

  test('a usage that only counts toward known names does not create one', () => {
    const registry = new NameRegistry()
    registry.observe('class', 'known')
    registry.observe('class', 'unknown', { onlyIfKnown: true })
    registry.assign()
    assert.equal(registry.get('class', 'unknown'), null)
    assert.throws(() => registry.exclude('class', 'known'))
    assert.throws(() => registry.reserve('class', ['z']))
  })
})

describe('implicit global variables', () => {
  function withPage (js, html = '<div id="foo"></div>', extra = {}) {
    const { files, warnings } = runOnFixture({ 'html/page.html': html, 'js/script.js': js, ...extra })
    return { js: files['js/script.js'], html: files['html/page.html'], files, warnings }
  }

  test('a shorthand property keeps its key', () => {
    assert.equal(withPage('send({ foo })').js, 'send({ foo: a })')
  })

  test('import.meta and new.target are not variables', () => {
    assert.equal(withPage('console.log(import.meta.url)', '<div id="meta"></div>').js, 'console.log(import.meta.url)')
    assert.equal(withPage('function F () { return new.target }', '<div id="target"></div>').js, 'function F () { return new.target }')
  })

  test('a global another file declares is not an element', () => {
    const { files } = withPage('console.log(config)', '<div id="config"></div>', { 'js/a.js': 'var config = 1' })
    assert.equal(files['js/script.js'], 'console.log(config)')
  })

  test('globals assigned without a declaration, or on window, are globals too', () => {
    assert.equal(withPage('foo = 1; console.log(foo)').js, 'foo = 1; console.log(foo)')
    const { files } = withPage('console.log(foo)', undefined, { 'js/a.js': 'window.foo = 1' })
    assert.equal(files['js/script.js'], 'console.log(foo)')
  })

  test('inline scripts on one page share their globals', () => {
    const html = '<div id="count"></div><script>var count = 0</script><script>count++</script>'
    assert.equal(minifyHtml(html), '<div id="a"></div><script>var count = 0</script><script>count++</script>')
  })

  test('a renamed id never lands on a global some script reads', () => {
    const { js } = withPage('a.init(); panel.hidden = true', '<div id="panel"></div>')
    assert.equal(js, 'a.init(); b.hidden = true')
  })

  test('a renamed id never becomes a reserved word', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `n${index}`)
    const { js } = withPage(ids.map(id => `${id}.x`).join(';'), ids.map(id => `<i id="${id}"></i>`).join(''))
    assert.doesNotThrow(() => new Function(js)) // eslint-disable-line no-new-func
  })

  test('a name the browser already defines is never renamed', () => {
    assert.equal(withPage('status.textContent = 1', '<div id="status"></div>').js, 'status.textContent = 1')
  })

  test('a class field value is still followed', () => {
    assert.equal(withPage('class A { el = foo }').js, 'class A { el = a }')
  })
})

describe('javascript only follows names markup and stylesheets define', () => {
  test('an id assigned to a plain object is left alone', () => {
    const { files } = runOnFixture({ 'html/page.html': '<div id="x"></div>', 'js/script.js': 'user.id = "admin"' })
    assert.equal(files['js/script.js'], 'user.id = "admin"')
  })

  test('a constant shadowed by a parameter is not traced', () => {
    const source = 'const key = "theme"; localStorage.getItem(key); function show (key) { return document.getElementById(key) }'
    const { files } = runOnFixture({ 'html/page.html': '<div id="theme"></div>', 'js/script.js': source })
    assert.equal(files['js/script.js'], source)
  })

  test('a constant rewritten some other way is not traced', () => {
    for (const source of ['let s = ".x"; [s] = list; document.querySelector(s)', 'let s = ".x"; for (s of list) document.querySelector(s)']) {
      const { files } = runOnFixture({ 'html/page.html': '<div class="x"></div>', 'js/script.js': source })
      assert.equal(files['js/script.js'], source)
    }
  })

  test('an unparseable script says its names may stop matching', () => {
    const { warnings } = runOnFixture({ 'html/page.html': '<div class="x"></div>', 'js/script.js': 'const = <div/>' })
    assert.ok(warnings.some(warning => warning.includes('may no longer match')))
  })
})

describe('preprocessor stylesheets', () => {
  test('an apostrophe in a line comment does not hide the next selector', () => {
    const { files } = runOnFixture({ 'html/page.html': '<div class="header"></div>', 'css/a.scss': "// it's the header\n.header { color: red }" })
    assert.equal(files['css/a.scss'], "// it's the header\n.a { color: red }")
    assert.equal(files['html/page.html'], '<div class="a"></div>')
  })

  test('names built with interpolation keep their spelling', () => {
    const tree = {
      'html/page.html': '<div class="icon-home home-badge other"></div>',
      'css/a.scss': '.icon-#{$n} { color: red }\n.#{$m}-badge { color: blue }\n.other { color: green }',
      'css/b.less': '.icon-@{n} { color: red }'
    }
    const { files, warnings } = runOnFixture(tree)
    assert.equal(files['html/page.html'], '<div class="icon-home home-badge a"></div>')
    assert.equal(files['css/a.scss'], '.icon-#{$n} { color: red }\n.#{$m}-badge { color: blue }\n.a { color: green }')
    assert.ok(warnings.some(warning => warning.includes('starting with "icon-"')))
    assert.ok(warnings.some(warning => warning.includes('ending with "-badge"')))
  })

  test('a name built with & keeps its spelling, along with its parent', () => {
    const tree = {
      'html/page.html': '<div class="btn btn-primary btn-primary-icon card"></div>',
      'css/a.scss': '.btn { &-primary { @media print { &-icon { color: red } } } }\n.card { & .inner { color: red } }'
    }
    const { files } = runOnFixture(tree)
    assert.equal(files['html/page.html'], '<div class="btn btn-primary btn-primary-icon a"></div>')
  })

  test('& onto a parent that cannot be worked out is reported', () => {
    const { warnings } = runOnFixture({ 'html/page.html': '<p class="x"></p>', 'css/a.scss': 'a:hover { &-x { color: red } }' })
    assert.ok(warnings.some(warning => warning.includes('cannot be worked out')))
  })

  test('a less mixin call keeps the name it calls', () => {
    const tree = {
      'html/page.html': '<div class="box rounded"></div>',
      'css/a.less': '.rounded { border-radius: 4px }\n#ns { .m() { color: red } }\n.box { .rounded; #ns > .m(); }'
    }
    const { files } = runOnFixture(tree)
    assert.equal(files['css/a.less'], '.rounded { border-radius: 4px }\n#ns { .m() { color: red } }\n.a { .rounded; #ns > .m(); }')
    assert.equal(files['html/page.html'], '<div class="a rounded"></div>')
  })

  test('url(//…) in a line-comment dialect is not a comment', () => {
    const source = '.alpha { background: url(//cdn.example.com/x.png) }\n.beta { color: red }'
    assert.equal(minifyCss(source, {}, 'scss'), '.a { background: url(//cdn.example.com/x.png) }\n.b { color: red }')
  })
})

describe('svg references by url(#id)', () => {
  test('presentation attributes and style attributes follow a renamed id', () => {
    const html = '<svg><linearGradient id="grad"></linearGradient><rect fill="url(#grad)" style="stroke: url(\'#grad\')" mask="url(#missing)"/></svg>'
    assert.equal(minifyHtml(html), '<svg><linearGradient id="a"></linearGradient><rect fill="url(#a)" style="stroke: url(\'#a\')" mask="url(#missing)"/></svg>')
  })

  test('stylesheets follow a renamed id', () => {
    const { files } = runOnFixture({ 'html/page.html': '<svg><clipPath id="clip"></clipPath></svg>', 'css/a.css': '.x { clip-path: url("#clip") }\n.y { mask: url(#clip-{x}) }' })
    assert.equal(files['css/a.css'], '.a { clip-path: url("#a") }\n.b { mask: url(#clip-{x}) }')
  })
})

describe('substring attribute selectors', () => {
  test('every class or id they could match keeps its spelling', () => {
    const tree = {
      'html/page.html': '<div id="main-nav" class="col-6 big-icon has-star lang-en other"></div>',
      'css/a.css': '[class^="col-"], [class$=-icon], [class*="star"], [class|=lang], [id^=main] { float: left }\n.other {}'
    }
    const { files } = runOnFixture(tree)
    assert.equal(files['html/page.html'], '<div id="main-nav" class="col-6 big-icon has-star lang-en a"></div>')
  })

  test('the same goes for ones in an exempt stylesheet', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mha-regress-'))
    fs.writeFileSync(path.join(root, 'vendor.css'), '[class^="col-"] { float: left }')
    const { files } = runOnFixture({ 'html/page.html': '<div class="col-6 other"></div>' }, { exemptStylesheets: [path.join(root, 'vendor.css')] })
    assert.equal(files['html/page.html'], '<div class="col-6 a"></div>')
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('files that cannot be read', () => {
  function withRoot (build) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mha-regress-'))
    for (const directory of ['html', 'css', 'js']) fs.mkdirSync(path.join(root, directory))
    build(root)
    minifyHtmlAttributes({ htmlDir: path.join(root, 'html'), cssDir: path.join(root, 'css'), jsDir: path.join(root, 'js'), maxFileSize: 1024 })
    fs.rmSync(root, { recursive: true, force: true })
    return minifyHtmlAttributes.lastRun.warnings
  }

  test('a template that is not utf-8, or too large, is reported', () => {
    const warnings = withRoot(root => {
      fs.writeFileSync(path.join(root, 'html', 'latin1.html'), Buffer.from('<div class="hero">caf\xe9</div>', 'latin1'))
      fs.writeFileSync(path.join(root, 'html', 'big.html'), `<div class="hero">${'x'.repeat(2048)}</div>`)
    })
    assert.ok(warnings.some(warning => warning.includes('latin1.html') && warning.includes('not valid UTF-8')))
    assert.ok(warnings.some(warning => warning.includes('big.html') && warning.includes('maxFileSize')))
  })

  test('a binary file among templates is skipped quietly, but not among stylesheets', () => {
    const warnings = withRoot(root => {
      fs.writeFileSync(path.join(root, 'html', 'logo.png'), Buffer.from([0x89, 0x50, 0x00]))
      fs.writeFileSync(path.join(root, 'css', 'broken.css'), Buffer.from([0x2e, 0x00]))
    })
    assert.equal(warnings.length, 1)
    assert.ok(warnings[0].includes('broken.css'))
  })

  test('readTextFile says why it skipped a file', () => {
    const reasons = []
    readTextFile(path.join(os.tmpdir(), 'mha-nope-' + Date.now()), { onSkip: reason => reasons.push(reason) })
    assert.deepEqual(reasons, ['unreadable'])
  })
})

describe('reading and listing files', () => {
  test('a byte order mark survives a rewrite', () => {
    const { files } = runOnFixture({ 'css/a.css': '﻿.alpha { color: red }' })
    assert.equal(files['css/a.css'], '﻿.a { color: red }')
  })

  test('symbolic links to files and directories are followed, and a loop is not', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mha-regress-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mha-regress-outside-'))
    try {
      fs.writeFileSync(path.join(outside, 'linked.html'), 'x')
      fs.mkdirSync(path.join(outside, 'dir'))
      fs.writeFileSync(path.join(outside, 'dir', 'inner.html'), 'x')
      fs.symlinkSync(path.join(outside, 'linked.html'), path.join(root, 'file-link.html'))
      fs.symlinkSync(path.join(outside, 'dir'), path.join(root, 'dir-link'), 'dir')
      fs.symlinkSync(root, path.join(root, 'loop'), 'dir')
      fs.symlinkSync(path.join(outside, 'gone'), path.join(root, 'broken'))
    } catch (error) {
      t.skip(`symbolic links are not available here: ${error.code}`)
      return
    }
    const found = listFiles(root).map(file => path.relative(root, file).split(path.sep).join('/'))
    assert.deepEqual(found, ['dir-link/inner.html', 'file-link.html'])
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })
})
