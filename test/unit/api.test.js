const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const minifyHtmlAttributes = require('../../minify-html-attributes')
const { runOnFixture } = require('../helpers')

describe('the returned object', () => {
  test('is keyed by file path and carries a type and the new contents', () => {
    const { edited, root } = runOnFixture({ 'html/page.html': '<p class="alpha"></p>', 'css/x.css': '.alpha { color: red }', 'js/x.js': "document.querySelector('.alpha')" })
    const entries = Object.entries(edited)
    assert.equal(entries.length, 3)
    for (const [filePath, entry] of entries) {
      assert.ok(path.isAbsolute(filePath))
      assert.ok(['html', 'css', 'js'].includes(entry.type))
      assert.equal(typeof entry.contents, 'string')
    }
    assert.equal(edited[path.join(root, 'html/page.html')].type, 'html')
    assert.equal(edited[path.join(root, 'css/x.css')].type, 'css')
    assert.equal(edited[path.join(root, 'js/x.js')].type, 'js')
  })

  test('leaves out files that did not change', () => {
    const { edited } = runOnFixture({ 'html/page.html': '<p class="alpha"></p>', 'html/other.html': '<p>nothing to rename</p>' })
    assert.equal(Object.keys(edited).length, 1)
  })

  test('does nothing at all when no directories are given', () => {
    assert.deepEqual(minifyHtmlAttributes(), {})
    assert.deepEqual(minifyHtmlAttributes({}), {})
  })
})

describe('options', () => {
  const tree = {
    'html/page.html': '<p class="alpha" id="beta" data-gamma="1" custom-attr="delta"></p>',
    'css/x.css': '.alpha { color: red }\n#beta { color: blue }\n[data-gamma] { color: green }'
  }

  test('disableClassReplacements', () => {
    const { files } = runOnFixture(tree, { disableClassReplacements: true })
    assert.ok(files['html/page.html'].includes('class="alpha"'))
    assert.ok(files['html/page.html'].includes('id="a"'))
    assert.ok(files['css/x.css'].includes('.alpha {'))
  })

  test('disableIdReplacements', () => {
    const { files } = runOnFixture(tree, { disableIdReplacements: true })
    assert.ok(files['html/page.html'].includes('id="beta"'))
    assert.ok(files['html/page.html'].includes('class="a"'))
    assert.ok(files['css/x.css'].includes('#beta {'))
  })

  test('disableDataReplacements', () => {
    const { files } = runOnFixture(tree, { disableDataReplacements: true })
    assert.ok(files['html/page.html'].includes('data-gamma="1"'))
    assert.ok(files['css/x.css'].includes('[data-gamma] {'))
  })

  test('renameAttributeValues renames the values of attributes you name', () => {
    const { files } = runOnFixture(tree, { renameAttributeValues: ['custom-attr'] })
    assert.ok(files['html/page.html'].includes('custom-attr="a"'))
  })

  test('renameAttributeValues keeps each attribute in its own namespace', () => {
    const { files } = runOnFixture({
      'html/page.html': '<p custom-one="shared" custom-two="shared"></p><q custom-two="other"></q>'
    }, { renameAttributeValues: ['custom-one', 'custom-two'] })
    assert.equal(files['html/page.html'], '<p custom-one="a" custom-two="a"></p><q custom-two="b"></q>')
  })

  test('exemptNames keeps a name and stops anything else claiming it', () => {
    const { files } = runOnFixture({
      'html/page.html': '<nav id="keep-me"></nav><p class="a"></p><p class="renamed"></p>',
      'css/x.css': '#keep-me { color: red }'
    }, { exemptNames: ['keep-me', 'a'] })
    assert.ok(files['html/page.html'].includes('id="keep-me"'))
    assert.ok(files['css/x.css'].includes('#keep-me {'))
    assert.ok(files['html/page.html'].includes('class="a"'), 'the exempt class keeps its name')
    assert.ok(files['html/page.html'].includes('class="b"'), 'and nothing else is handed that name')
  })

  test('onWarning is called as problems are found', () => {
    const seen = []
    runOnFixture({ 'js/broken.js': 'this is ( not javascript' }, { onWarning: message => seen.push(message) })
    assert.equal(seen.length, 1)
    assert.match(seen[0], /could not be parsed/)
  })

  test('cssExtensions and jsExtensions can be overridden', () => {
    const { files } = runOnFixture({
      'html/page.html': '<p class="alpha"></p>',
      'css/x.styl': '.alpha { color: red }'
    }, { cssExtensions: ['.styl'] })
    assert.equal(files['css/x.styl'], '.a { color: red }')
  })

  test('htmlExtensions narrows which files are read as markup', () => {
    const { files } = runOnFixture({
      'html/page.html': '<p class="alpha"></p>',
      'html/notes.md': 'a note mentioning <p class="alpha"> in passing'
    }, { htmlExtensions: ['.html'] })
    assert.equal(files['html/page.html'], '<p class="a"></p>')
    assert.equal(files['html/notes.md'], 'a note mentioning <p class="alpha"> in passing')
  })
})

describe('coordination across a whole app', () => {
  // modeled on the shapes that turn up in a real site: a layout, a nested partial, a preprocessor stylesheet, and several js modules
  const app = {
    'html/layouts/main.html': '<!doctype html>\n<html>\n<head>\n<style>.banner { color: red }</style>\n</head>\n<body class="content">\n<nav id="mainNav"><a href="#skip">skip</a></nav>\n<article id="skip">{pageContent|s}</article>\n</body>\n</html>\n',
    'html/page.html': '<section class="content banner" data-confirm="Are you sure?">\n<label for="email">Email</label>\n<input id="email" name="email">\n</section>\n',
    'css/site.less': '// site styles\n@brand: #f00;\nbody.content {\n  nav#mainNav { color: @brand }\n  .banner { color: @brand }\n}\n[data-confirm] { cursor: pointer }\n',
    'js/widget.js': "const cookie = require('lib/cookies')\n\nmodule.exports = () => {\n  if (document.body.classList.contains('content')) {\n    const nav = document.querySelectorAll('#mainNav details')[0]\n    document.getElementById('email').setAttribute('placeholder', 'you@example.com')\n    nav.insertAdjacentHTML('beforeend', '<span class=\"banner\">|</span>')\n    for (const el of document.querySelectorAll('[data-confirm]')) console.log(el.getAttribute('data-confirm'))\n    cookie.set('theme', 'dark')\n  }\n}\n"
  }

  test('every reference to a name lands on the same replacement', () => {
    const { files, nameMap } = runOnFixture(app)
    const contentClass = nameMap.class.content
    const bannerClass = nameMap.class.banner
    const navId = nameMap.id.mainNav
    const confirmData = nameMap.data.confirm

    assert.ok(files['html/layouts/main.html'].includes(`<body class="${contentClass}">`))
    assert.ok(files['html/layouts/main.html'].includes(`<style>.${bannerClass} { color: red }</style>`))
    assert.ok(files['html/layouts/main.html'].includes(`<nav id="${navId}">`))
    assert.ok(files['html/page.html'].includes(`class="${contentClass} ${bannerClass}"`))
    assert.ok(files['html/page.html'].includes(`data-${confirmData}="Are you sure?"`))
    assert.ok(files['css/site.less'].includes(`body.${contentClass} {`))
    assert.ok(files['css/site.less'].includes(`nav#${navId} { color: @brand }`))
    assert.ok(files['css/site.less'].includes(`[data-${confirmData}] { cursor: pointer }`))
    assert.ok(files['js/widget.js'].includes(`classList.contains('${contentClass}')`))
    assert.ok(files['js/widget.js'].includes(`querySelectorAll('#${navId} details')`))
    assert.ok(files['js/widget.js'].includes(`<span class="${bannerClass}">`))
    assert.ok(files['js/widget.js'].includes(`getAttribute('data-${confirmData}')`))
  })

  test('the label keeps pointing at its input', () => {
    const { files, nameMap } = runOnFixture(app)
    const emailId = nameMap.id.email
    assert.ok(files['html/page.html'].includes(`<label for="${emailId}">`))
    assert.ok(files['html/page.html'].includes(`<input id="${emailId}" name="email">`))
    assert.ok(files['js/widget.js'].includes(`getElementById('${emailId}')`))
  })

  test('the fragment link keeps pointing at its target', () => {
    const { files, nameMap } = runOnFixture(app)
    const skipId = nameMap.id.skip
    assert.ok(files['html/layouts/main.html'].includes(`href="#${skipId}"`))
    assert.ok(files['html/layouts/main.html'].includes(`<article id="${skipId}">`))
  })

  test('nothing that was not a name is disturbed', () => {
    const { files } = runOnFixture(app)
    assert.ok(files['js/widget.js'].includes("require('lib/cookies')"), 'module paths must survive')
    assert.ok(files['js/widget.js'].includes("cookie.set('theme', 'dark')"), 'unrelated strings must survive')
    assert.ok(files['js/widget.js'].includes("'you@example.com'"), 'unrelated attribute values must survive')
    assert.ok(files['css/site.less'].includes('// site styles'), 'comments must survive')
    assert.ok(files['css/site.less'].includes('@brand: #f00;'), 'preprocessor variables must survive')
    assert.ok(files['html/page.html'].includes('name="email"'), 'the name attribute must survive')
    assert.ok(files['html/layouts/main.html'].includes('{pageContent|s}'), 'template syntax must survive')
  })

  test('the same input always produces the same output', () => {
    const first = runOnFixture(app)
    const second = runOnFixture(app)
    assert.deepEqual(first.files, second.files)
    assert.deepEqual(first.nameMap, second.nameMap)
  })

  test('runs clean, with no warnings', () => {
    assert.deepEqual(runOnFixture(app).warnings, [])
  })
})

describe('the same directory can hold html, css, and js', () => {
  test('stylesheets in the html directory are not read as markup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mha-shared-'))
    fs.writeFileSync(path.join(root, 'page.html'), '<p class="alpha"></p>')
    fs.writeFileSync(path.join(root, 'styles.css'), '.alpha { color: red }')
    fs.writeFileSync(path.join(root, 'script.js'), "document.querySelector('.alpha')")

    const edited = minifyHtmlAttributes({ htmlDir: root, cssDir: root, jsDir: root })
    assert.equal(edited[path.join(root, 'page.html')].contents, '<p class="a"></p>')
    assert.equal(edited[path.join(root, 'styles.css')].contents, '.a { color: red }')
    assert.equal(edited[path.join(root, 'styles.css')].type, 'css')
    assert.equal(edited[path.join(root, 'script.js')].contents, "document.querySelector('.a')")
    assert.equal(edited[path.join(root, 'script.js')].type, 'js')
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('scale', () => {
  test('handles a few thousand names across a few hundred files quickly', () => {
    const tree = {}
    for (let page = 0; page < 200; page++) {
      const classes = Array.from({ length: 10 }, (unused, index) => `page${page}-class${index}`)
      tree[`html/page${page}.html`] = classes.map(name => `<p class="${name}" id="${name}-id"></p>`).join('\n')
      tree[`css/page${page}.css`] = classes.map(name => `.${name} { color: red }`).join('\n')
      tree[`js/page${page}.js`] = classes.map(name => `document.querySelector('.${name}')`).join('\n')
    }

    const started = Date.now()
    const { files, nameMap } = runOnFixture(tree)
    const elapsed = Date.now() - started

    assert.equal(Object.keys(nameMap.class).length, 2000)
    assert.equal(Object.keys(nameMap.id).length, 2000)
    // the old implementation ran one regular expression per known name over every file, which is quadratic; this must not creep back in
    assert.ok(elapsed < 20000, `took ${elapsed}ms`)

    const name = nameMap.class['page7-class3']
    assert.ok(files['html/page7.html'].includes(`class="${name}"`))
    assert.ok(files['css/page7.css'].includes(`.${name} {`))
    assert.ok(files['js/page7.js'].includes(`querySelector('.${name}')`))
  })

  test('names longer than one character are handed out once the alphabet runs out', () => {
    const classes = Array.from({ length: 120 }, (unused, index) => `class-number-${index}`)
    const { nameMap } = runOnFixture({ 'html/page.html': classes.map(name => `<p class="${name}"></p>`).join('') })
    const assigned = Object.values(nameMap.class)
    assert.equal(new Set(assigned).size, 120, 'every name must be unique')
    assert.equal(assigned[0], 'a')
    assert.equal(assigned[52], 'aa')
  })
})

describe('stylesheets we are not allowed to edit', () => {
  test('names defined in an exempt stylesheet are left alone everywhere', () => {
    // a vendored theme imported from node_modules cannot be rewritten, so the markup that uses its classes must keep the original names
    const vendored = path.join(os.tmpdir(), `mha-vendored-${process.pid}-${Date.now()}.css`)
    fs.writeFileSync(vendored, '.vendorButton, .radios { color: red }\n#vendorRoot { color: blue }')

    const { files, nameMap } = runOnFixture({
      'html/page.html': '<div id="vendorRoot"><p class="vendorButton ourClass"></p></div>',
      'css/site.css': '.ourClass { color: green }'
    }, { exemptStylesheets: [vendored] })

    assert.ok(files['html/page.html'].includes('id="vendorRoot"'))
    assert.ok(files['html/page.html'].includes('vendorButton'))
    assert.ok(files['html/page.html'].includes(nameMap.class.ourClass))
    assert.equal(nameMap.class.vendorButton, undefined, 'a vendored class must not be renamed')
    fs.rmSync(vendored)
  })

  test('a directory of exempt stylesheets is read recursively', () => {
    const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mha-vendor-'))
    fs.mkdirSync(path.join(vendorDir, 'nested'))
    fs.writeFileSync(path.join(vendorDir, 'nested', 'theme.css'), '.vendorButton { color: red }')

    const { files } = runOnFixture({ 'html/page.html': '<p class="vendorButton ourClass"></p>' }, { exemptStylesheets: [vendorDir] })
    assert.equal(files['html/page.html'], '<p class="vendorButton a"></p>')
    fs.rmSync(vendorDir, { recursive: true, force: true })
  })

  test('an exempt stylesheet that cannot be read is reported', () => {
    const { warnings } = runOnFixture({ 'html/page.html': '<p class="alpha"></p>' }, { exemptStylesheets: [path.join(os.tmpdir(), 'mha-missing.css')] })
    assert.ok(warnings.some(warning => warning.includes('could not be read')))
  })
})
