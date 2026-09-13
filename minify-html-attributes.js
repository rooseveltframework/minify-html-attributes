const fs = require('node:fs')
const path = require('node:path')
const { listFiles, readTextFile, hasExtension } = require('./lib/files')
const { NameRegistry } = require('./lib/names')
const { applyEdits } = require('./lib/edits')
const { scanHtml } = require('./lib/html')
const { scanStylesheet } = require('./lib/css')
const { analyzeJs } = require('./lib/js')

const DEFAULT_CSS_EXTENSIONS = ['.css', '.less', '.scss']
const DEFAULT_JS_EXTENSIONS = ['.js', '.mjs', '.cjs']

// dialects where `//` starts a comment; in plain css it does not
const LINE_COMMENT_EXTENSIONS = new Set(['.less', '.scss', '.sass'])

// which namespace each reported token belongs to
const NAMESPACES = {
  class: 'class',
  id: 'id',
  idReference: 'id',
  globalVariable: 'id',
  data: 'data'
}

// tokens that merely point at a name defined elsewhere. these are renamed to follow whatever the definition became, but they never bring a new name into existence: an undeclared javascript variable is only an element id if some element really claims that id.
const REFERENCE_ONLY_KINDS = new Set(['idReference', 'globalVariable'])

function namespaceOf (token) {
  if (token.kind === 'attrValue') return `attr:${token.attribute}`
  return NAMESPACES[token.kind] ?? null
}

// minifies html attribute class names, ids, and data-* attribute names in a coordinated fashion across a set of html, css, and js files. takes the params documented in CONFIGURATION.md and returns a map of file path to { type, contents } for the files it changed.
//
// works in two passes: every file is analyzed first so that the complete set of names is known before any of them is assigned a replacement, then every file is rewritten by splicing replacements into the original text. nothing is ever re-serialized from a syntax tree, so formatting, comments, and template language syntax survive untouched.
function minifyHtmlAttributes (params = {}) {
  const warnings = []
  const warn = message => {
    warnings.push(message)
    params.onWarning?.(message)
  }

  const valueAttributes = new Set((params.renameAttributeValues ?? []).map(attribute => attribute.toLowerCase()))
  const cssExtensions = (params.cssExtensions ?? DEFAULT_CSS_EXTENSIONS).map(extension => extension.toLowerCase())
  const jsExtensions = (params.jsExtensions ?? DEFAULT_JS_EXTENSIONS).map(extension => extension.toLowerCase())

  const disabledNamespaces = []
  if (params.disableClassReplacements) disabledNamespaces.push('class')
  if (params.disableIdReplacements) disabledNamespaces.push('id')
  if (params.disableDataReplacements) disabledNamespaces.push('data')

  // stylesheets outside cssDir are not ours to rewrite, so every name they define has to keep its original spelling on our side of the fence too
  const exemptNames = new Set(params.exemptNames ?? [])
  for (const name of namesInExternalStylesheets(params.exemptStylesheets, warn)) exemptNames.add(name)

  const registry = new NameRegistry({ exemptNames: [...exemptNames], disabledNamespaces })

  const scanOptions = {
    valueAttributes,
    disableClassReplacements: !!params.disableClassReplacements,
    disableIdReplacements: !!params.disableIdReplacements,
    disableDataReplacements: !!params.disableDataReplacements,
    disableGlobalVariableReplacements: !!params.disableGlobalVariableReplacements,
    warn,
    scanHtml
  }

  // discovery

  const files = new Map() // path -> { type, source }

  function classify (filePath, type) {
    if (files.has(filePath)) return
    const source = readTextFile(filePath, { maxBytes: params.maxFileSize })
    if (source === null) return // binary, unreadable, or oversized
    files.set(filePath, { type, source })
  }

  // css and js are claimed by extension first so that a directory serving as both the html and the statics root does not get its stylesheets parsed as markup
  for (const filePath of listFiles(params.cssDir)) if (hasExtension(filePath, cssExtensions)) classify(filePath, 'css')
  for (const filePath of listFiles(params.jsDir)) if (hasExtension(filePath, jsExtensions)) classify(filePath, 'js')
  for (const filePath of listFiles(params.htmlDir)) {
    if (hasExtension(filePath, cssExtensions) || hasExtension(filePath, jsExtensions)) continue
    if (params.htmlExtensions && !hasExtension(filePath, params.htmlExtensions)) continue
    classify(filePath, 'html')
  }

  // analysis pass

  const tokensByFile = new Map()

  for (const [filePath, file] of files) {
    const tokens = []
    const collect = token => {
      if (namespaceOf(token)) tokens.push(token)
    }
    try {
      if (file.type === 'html') analyzeHtmlFile(file.source, collect, filePath)
      else if (file.type === 'css') analyzeCssFile(file.source, collect, filePath)
      else analyzeJsFile(file.source, collect)
    } catch (error) {
      warn(`${filePath} could not be parsed and was left alone: ${error.message}`)
      continue
    }
    tokensByFile.set(filePath, tokens)
    for (const token of tokens) {
      if (!REFERENCE_ONLY_KINDS.has(token.kind)) registry.observe(namespaceOf(token), token.name)
    }
  }

  registry.assign()

  // rewrite pass

  const editedFiles = {}

  for (const [filePath, file] of files) {
    const tokens = tokensByFile.get(filePath)
    if (!tokens?.length) continue
    const edits = []
    for (const token of tokens) {
      const minified = registry.get(namespaceOf(token), token.name)
      if (!minified) continue
      // renaming an undeclared javascript variable must not collide with a name the file already binds
      if (token.avoid?.has(minified)) {
        warn(`${filePath}: could not rename the global "${token.name}" because "${minified}" is already used in that file`)
        continue
      }
      edits.push({ start: token.start, end: token.end, text: minified })
    }
    const contents = applyEdits(file.source, edits)
    if (contents !== file.source) editedFiles[filePath] = { type: file.type, contents }
  }

  minifyHtmlAttributes.lastRun = { nameMap: registry.toJSON(), warnings, fileCount: files.size }

  return editedFiles

  // analyzers

  function analyzeHtmlFile (source, collect, filePath) {
    scanHtml(source, collect, {
      ...scanOptions,
      onStyle: (css, offset) => scanStylesheet(css, shift(collect, offset), { ...scanOptions, lineComments: false }),
      onScript: (js, offset) => analyzeEmbeddedJs(js, shift(collect, offset), `${filePath} (inline script)`),
      onHtml: (html, offset) => scanHtml(html, shift(collect, offset), scanOptions),
      onEventHandler: attribute => analyzeEventHandler(attribute, collect, filePath)
    })
  }

  function analyzeCssFile (source, collect, filePath) {
    scanStylesheet(source, collect, { ...scanOptions, lineComments: LINE_COMMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase()) })
  }

  function analyzeJsFile (source, collect) {
    analyzeJs(source, collect, scanOptions)
  }

  function analyzeEmbeddedJs (source, collect, label) {
    try {
      analyzeJs(source, collect, scanOptions)
    } catch (error) {
      warn(`${label} could not be parsed and was left alone: ${error.message}`)
    }
  }

  // inline event handlers hold javascript inside an html attribute value. the value is html-escaped, so it is only safe to edit in place when there are no entities to shift the offsets around.
  function analyzeEventHandler (attribute, collect, filePath) {
    if (attribute.value === null || !attribute.value.trim()) return
    if (attribute.value.includes('&')) {
      warn(`${filePath}: the ${attribute.name} handler contains html entities and was left alone`)
      return
    }
    analyzeEmbeddedJs(attribute.value, shift(collect, attribute.valueStart), `${filePath} (${attribute.name} handler)`)
  }
}

// collects every class and id defined by stylesheets the caller is not letting us edit, such as a vendored theme pulled in with `@import` from node_modules. renaming those names in the markup would leave the vendored rules pointing at elements that no longer exist.
function namesInExternalStylesheets (paths, warn) {
  const names = new Set()
  for (const entry of paths ?? []) {
    const files = fs.statSync(entry, { throwIfNoEntry: false })?.isDirectory() ? listFiles(entry) : [entry]
    for (const filePath of files) {
      const source = readTextFile(filePath)
      if (source === null) {
        warn(`the exempt stylesheet ${filePath} could not be read`)
        continue
      }
      const lineComments = LINE_COMMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
      scanStylesheet(source, token => names.add(token.name), { lineComments })
    }
  }
  return names
}

// offsets every token a nested scan reports so it lands in the outer file
function shift (collect, offset) {
  return token => collect({ ...token, start: token.start + offset, end: token.end + offset })
}

module.exports = minifyHtmlAttributes
