const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const minifyHtmlAttributes = require('../minify-html-attributes')

let counter = 0

// writes a throwaway app to a temp directory, runs the minifier over it, and returns the resulting text of every file whether it changed or not
function runOnFixture (tree, params = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mha-${process.pid}-${counter++}-`))
  for (const [relativePath, contents] of Object.entries(tree)) {
    const filePath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, contents)
  }

  const edited = minifyHtmlAttributes({
    htmlDir: path.join(root, 'html'),
    cssDir: path.join(root, 'css'),
    jsDir: path.join(root, 'js'),
    ...params
  })

  const files = {}
  for (const relativePath of Object.keys(tree)) {
    const filePath = path.join(root, relativePath)
    files[relativePath] = edited[filePath]?.contents ?? fs.readFileSync(filePath, 'utf8')
  }

  const { nameMap, warnings } = minifyHtmlAttributes.lastRun
  fs.rmSync(root, { recursive: true, force: true })
  return { files, edited, nameMap, warnings, root }
}

// convenience wrappers for the common single-file cases
function minifyHtml (html, params) {
  return runOnFixture({ 'html/page.html': html }, params).files['html/page.html']
}

function minifyCss (css, params, extension = 'css') {
  return runOnFixture({ [`css/styles.${extension}`]: css }, params).files[`css/styles.${extension}`]
}

function minifyJs (js, params) {
  return runOnFixture({ 'js/script.js': js }, params).files['js/script.js']
}

module.exports = { runOnFixture, minifyHtml, minifyCss, minifyJs }
