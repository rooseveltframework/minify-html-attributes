const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { minifyCss, runOnFixture } = require('../helpers')

describe('css selectors', () => {
  test('renames class and id selectors', () => {
    assert.equal(minifyCss('.alpha { color: red }\n#beta { color: blue }'), '.a { color: red }\n#a { color: blue }')
  })

  test('leaves element names, pseudo classes, and combinators alone', () => {
    const source = 'main article > p:first-of-type::before, section + aside { color: red }'
    assert.equal(minifyCss(source), source)
  })

  test('descends into functional pseudo classes', () => {
    assert.equal(minifyCss('li:not(.alpha):has(> .beta) { color: red }'), 'li:not(.a):has(> .b) { color: red }')
  })

  test('leaves declaration values alone', () => {
    const source = '.alpha { background: url(alpha.png) #alpha; content: ".alpha" }'
    assert.equal(minifyCss(source), '.a { background: url(alpha.png) #alpha; content: ".alpha" }')
  })

  test('does not mistake a hex color or a decimal for a name', () => {
    const source = '.alpha { color: #abcdef; margin: 1.5em }'
    assert.equal(minifyCss(source), '.a { color: #abcdef; margin: 1.5em }')
  })

  test('handles media queries and other nesting at-rules', () => {
    const source = '@media (min-width: 900px) { .alpha { color: red } }\n@supports (display: grid) { #beta { color: red } }'
    assert.equal(minifyCss(source), '@media (min-width: 900px) { .a { color: red } }\n@supports (display: grid) { #a { color: red } }')
  })

  test('leaves keyframe steps and font faces alone', () => {
    const source = '@keyframes spin { from { opacity: 0 } to { opacity: 1 } }\n@font-face { font-family: "Lato" }'
    assert.equal(minifyCss(source), source)
  })

  test('preserves comments and formatting exactly', () => {
    const source = '/* a comment mentioning .alpha */\n\n.alpha,\n.beta {\n\tcolor : red ;\n}\n'
    assert.equal(minifyCss(source), '/* a comment mentioning .alpha */\n\n.a,\n.b {\n\tcolor : red ;\n}\n')
  })

  test('handles css nesting', () => {
    assert.equal(minifyCss('.alpha { color: red; & .beta { color: blue } }'), '.a { color: red; & .b { color: blue } }')
  })
})

describe('attribute selectors', () => {
  test('renames data attribute names', () => {
    assert.equal(minifyCss('[data-confirm] { color: red }'), '[data-a] { color: red }')
  })

  test('renames class and id values inside attribute selectors', () => {
    assert.equal(minifyCss('[class~="alpha"] { color: red }\n[id="beta"] { color: red }'), '[class~="a"] { color: red }\n[id="a"] { color: red }')
  })

  test('leaves attributes it does not own alone', () => {
    const source = 'select[name="readerRating"], a[href="#top"], input[type=text] { color: red }'
    assert.equal(minifyCss(source), source)
  })

  test('refuses to rename substring matches, which cannot be renamed safely', () => {
    const source = '[data-thing^="alpha"] { color: red }'
    // the attribute name is still ours, but the value must survive untouched
    assert.equal(minifyCss(source), '[data-a^="alpha"] { color: red }')
  })
})

describe('preprocessor dialects', () => {
  const less = `// a line comment mentioning .ghost
@brand: #f00;

body.content {
  background: url('/@{version}/x.png');

  nav#main {
    color: @brand;

    &:hover { color: blue }
  }

  .nested { color: red }
}

.mixin() { color: red }
.box { .mixin(); }
`

  test('handles less nesting, variables, interpolation, and line comments', () => {
    const output = minifyCss(less, {}, 'less')
    assert.ok(output.includes('// a line comment mentioning .ghost'), 'line comments must survive verbatim')
    assert.ok(output.includes('@brand: #f00;'))
    assert.ok(output.includes("url('/@{version}/x.png')"), 'less interpolation must not be renamed')
    assert.ok(/body\.[a-z]+ \{/.test(output))
    assert.ok(/nav#[a-z]+ \{/.test(output))
    assert.ok(output.includes('&:hover'))
    assert.ok(output.includes('.mixin() { color: red }'), 'mixin definitions must not be renamed')
    assert.ok(output.includes('.mixin();'), 'mixin calls must not be renamed')
  })

  test('handles scss nesting and follows @extend', () => {
    const output = minifyCss('.alpha { color: red }\n.beta { @extend .alpha; }', {}, 'scss')
    assert.equal(output, '.a { color: red }\n.b { @extend .a; }')
  })

  test('warns about names built by concatenating onto the parent selector', () => {
    const { warnings } = runOnFixture({ 'css/styles.scss': '.block { &-element { color: red } }' })
    assert.ok(warnings.some(warning => warning.includes('&')), 'the user needs to know these names cannot be renamed')
  })

  test('a plain .css file does not treat // as a comment', () => {
    const source = '.alpha { background: url(http://example.com/x.png) }'
    assert.equal(minifyCss(source), '.a { background: url(http://example.com/x.png) }')
  })
})

describe('css and html agree', () => {
  test('a class used in both gets the same name', () => {
    const { files } = runOnFixture({
      'html/page.html': '<p class="shared"></p>',
      'css/styles.css': '.shared { color: red }'
    })
    const htmlName = /class="(\w+)"/.exec(files['html/page.html'])[1]
    const cssName = /\.(\w+) \{/.exec(files['css/styles.css'])[1]
    assert.equal(htmlName, cssName)
  })

  test('a class that only exists in css is still renamed', () => {
    const { files } = runOnFixture({ 'css/styles.css': '.orphan { color: red }' })
    assert.equal(files['css/styles.css'], '.a { color: red }')
  })
})
