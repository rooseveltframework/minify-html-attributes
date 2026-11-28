const fs = require('node:fs')
const path = require('node:path')
const { listFiles, readTextFile, hasExtension } = require('./lib/files')
const { NameRegistry } = require('./lib/names')
const { applyEdits } = require('./lib/edits')
const { scanHtml } = require('./lib/html')
const { scanStylesheet } = require('./lib/css')
const { analyzeJs, PROTECTED_GLOBALS, RESERVED_WORDS } = require('./lib/js')

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

// names that keep their spelling because a selector matches them by part of their name, as in `[class^="col-"]`, or because a preprocessor builds them out of other names
function matchesPattern (name, pattern) {
  switch (pattern.match) {
    case 'exact': return name === pattern.name
    case 'prefix': return name.startsWith(pattern.name)
    case 'suffix': return name.endsWith(pattern.name)
    case 'contains': return name.includes(pattern.name)
  }
  return false
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
  const idReferenceAttributes = new Set((params.idReferenceAttributes ?? []).map(attribute => attribute.toLowerCase()))
  const cssExtensions = (params.cssExtensions ?? DEFAULT_CSS_EXTENSIONS).map(extension => extension.toLowerCase())
  const jsExtensions = (params.jsExtensions ?? DEFAULT_JS_EXTENSIONS).map(extension => extension.toLowerCase())

  const disabledNamespaces = []
  if (params.disableClassReplacements) disabledNamespaces.push('class')
  if (params.disableIdReplacements) disabledNamespaces.push('id')
  if (params.disableDataReplacements) disabledNamespaces.push('data')

  // stylesheets outside cssDir are not ours to rewrite, so every name they define has to keep its original spelling on our side of the fence too
  const exemptNames = new Set(params.exemptNames ?? [])
  const patterns = [] // { namespace, match, name } for names that must keep their spelling, see matchesPattern
  const external = namesInExternalStylesheets(params.exemptStylesheets, warn)
  for (const name of external.names) exemptNames.add(name)
  patterns.push(...external.patterns)

  // every script on a page shares one set of globals, so these are gathered across every file: a global one script defines is never mistaken for an element id in another, and a renamed id never lands on a name that some script already reads
  const scriptGlobals = new Set()
  const scriptFreeNames = new Set()
  const onScriptNames = ({ globals, free }) => {
    for (const name of globals) scriptGlobals.add(name)
    for (const name of free) scriptFreeNames.add(name)
  }

  // the same goes for scripts outside jsDir, such as a library bundled in from node_modules: the names it looks for in the markup have to keep their spelling
  for (const name of namesInExternalScripts(params.exemptScripts, jsExtensions, warn, onScriptNames)) exemptNames.add(name)

  const registry = new NameRegistry({ exemptNames: [...exemptNames], disabledNamespaces })

  // class values this run had to leave alone, so they can be reported together once the run is done. keyed by what was left alone, holding the files it was found in
  const unrenamedClasses = { expression: new Map(), embedded: new Map() }

  const scanOptions = {
    valueAttributes,
    idReferenceAttributes,
    disableClassReplacements: !!params.disableClassReplacements,
    disableIdReplacements: !!params.disableIdReplacements,
    disableDataReplacements: !!params.disableDataReplacements,
    disableGlobalVariableReplacements: !!params.disableGlobalVariableReplacements,
    warn,
    scanHtml,
    onScriptNames
  }

  // discovery

  const files = new Map() // path -> { type, source }

  function classify (filePath, type) {
    if (files.has(filePath)) return
    const onSkip = reason => {
      // binary files are expected among html templates, such as images kept alongside them, but anything else that is skipped still has its names renamed everywhere else, so it has to be reported
      if (reason === 'binary' && type === 'html') return
      warn(`${filePath} was skipped because it is ${reason === 'too large' ? `larger than maxFileSize (${params.maxFileSize ?? 16 * 1024 * 1024} bytes)` : reason === 'not utf-8' ? 'not valid UTF-8' : reason}, so any class, id, or data-* name it uses may no longer match`)
    }
    const source = readTextFile(filePath, { maxBytes: params.maxFileSize, onSkip })
    if (source === null) return
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
    const filePatterns = []
    const collect = token => {
      if (token.kind === 'pattern') filePatterns.push(token)
      else if (namespaceOf(token)) tokens.push(token)
    }
    try {
      if (file.type === 'html') analyzeHtmlFile(file.source, collect, filePath)
      else if (file.type === 'css') analyzeCssFile(file.source, collect, filePath)
      else analyzeJsFile(file.source, collect)
    } catch (error) {
      warn(`${filePath} could not be parsed and was left alone, so any class, id, or data-* name it uses may no longer match: ${error.message}`)
      continue
    }
    tokensByFile.set(filePath, tokens)
    patterns.push(...filePatterns)
    for (const token of tokens) {
      // javascript only ever follows names: a string it happens to assign to some object's `id` is not proof that an element has that id, so only names that markup or a stylesheet defines are renamed
      if (!REFERENCE_ONLY_KINDS.has(token.kind) && !token.referenceOnly) registry.observe(namespaceOf(token), token.name)
    }
  }

  // a name javascript uses still counts toward how short its replacement is, as long as markup or a stylesheet defines it
  for (const tokens of tokensByFile.values()) {
    for (const token of tokens) {
      if (token.referenceOnly && !REFERENCE_ONLY_KINDS.has(token.kind)) registry.observe(namespaceOf(token), token.name, { onlyIfKnown: true })
    }
  }

  // names a substring selector or a preprocessor depends on keep their spelling
  for (const namespace of registry.namespaces.keys()) {
    const namespacePatterns = patterns.filter(pattern => pattern.namespace === namespace)
    if (!namespacePatterns.length) continue
    for (const name of registry.observed(namespace)) {
      if (namespacePatterns.some(pattern => matchesPattern(name, pattern))) registry.exclude(namespace, name)
    }
  }

  // an undeclared variable that some script defines as a global is that global, not an element
  for (const tokens of tokensByFile.values()) {
    for (let index = tokens.length - 1; index >= 0; index--) {
      if (tokens[index].kind === 'globalVariable' && scriptGlobals.has(tokens[index].name)) tokens.splice(index, 1)
    }
  }

  // an id that a script refers to as a global variable becomes a variable name when it is renamed, so it must never take a reserved word, a name the browser already defines, or a name some script already uses
  const idNames = new Set(registry.observed('id'))
  registry.reserve('id', [...RESERVED_WORDS, ...PROTECTED_GLOBALS, ...scriptGlobals, ...scriptFreeNames])
  for (const tokens of tokensByFile.values()) {
    for (const token of tokens) if (token.kind === 'globalVariable' && idNames.has(token.name)) registry.reserve('id', token.fileBindings)
  }

  registry.assign()

  // a class a template produces at render time keeps its original spelling, so it only stops matching if the same name was renamed in the css or js. that cannot be known from here, so it is reported, but only when some class was actually renamed
  if (Object.keys(registry.toJSON().class ?? {}).length) {
    const describe = found => [...found].map(([text, files]) => `${text} (${[...files].join(', ')})`).join('; ')
    if (unrenamedClasses.expression.size) warn(`class values built by template expressions were left as they are, so a class they produce will not match it if it was renamed in your css or js: ${describe(unrenamedClasses.expression)}. Add any class they can produce to exemptNames.`)
    if (unrenamedClasses.embedded.size) warn(`class attributes written inside other attributes, such as a template's conditional attributes, were left as they are, so a class in them will not match it if it was renamed in your css or js. Found in: ${describe(unrenamedClasses.embedded)}. Add those classes to exemptNames, or apply that state some other way, such as a data-* attribute.`)
  }

  // rewrite pass

  const editedFiles = {}

  for (const [filePath, file] of files) {
    const tokens = tokensByFile.get(filePath)
    if (!tokens?.length) continue
    const edits = []
    for (const token of tokens) {
      const minified = registry.get(namespaceOf(token), token.name)
      if (!minified) continue
      // a shorthand property such as `{ foo }` is expanded so that only the variable is renamed, not the key
      edits.push({ start: token.start, end: token.end, text: token.rewrite ? token.rewrite(minified) : minified })
    }
    const contents = applyEdits(file.source, edits)
    if (contents !== file.source) editedFiles[filePath] = { type: file.type, contents }
  }

  minifyHtmlAttributes.lastRun = { nameMap: registry.toJSON(), warnings, fileCount: files.size }

  return editedFiles

  // analyzers

  // tokens found in javascript follow names that markup and stylesheets define, and never bring a new one into existence
  function asReferences (collect) {
    return token => collect({ ...token, referenceOnly: true })
  }

  function analyzeHtmlFile (source, collect, filePath) {
    const onUnrenamedClass = ({ kind, text }) => {
      const files = unrenamedClasses[kind].get(text) ?? new Set()
      files.add(filePath)
      unrenamedClasses[kind].set(text, files)
    }
    scanHtml(source, collect, {
      ...scanOptions,
      onUnrenamedClass,
      onStyle: (css, offset) => scanStylesheet(css, shift(collect, offset), { ...scanOptions, lineComments: false }),
      onScript: (js, offset) => analyzeEmbeddedJs(js, shift(asReferences(collect), offset), `${filePath} (inline script)`),
      onHtml: (html, offset) => scanHtml(html, shift(collect, offset), { ...scanOptions, onUnrenamedClass }),
      onEventHandler: attribute => analyzeEventHandler(attribute, asReferences(collect), filePath)
    })
  }

  function analyzeCssFile (source, collect, filePath) {
    scanStylesheet(source, collect, { ...scanOptions, lineComments: LINE_COMMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase()) })
  }

  function analyzeJsFile (source, collect) {
    analyzeJs(source, asReferences(collect), scanOptions)
  }

  function analyzeEmbeddedJs (source, collect, label) {
    try {
      analyzeJs(source, collect, scanOptions)
    } catch (error) {
      warn(`${label} could not be parsed and was left alone, so any class, id, or data-* name it uses may no longer match: ${error.message}`)
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

// collects every class and id defined by stylesheets the caller is not letting us edit, such as a vendored theme pulled in with `@import` from node_modules. renaming those names in the markup would leave the vendored rules pointing at elements that no longer exist. substring selectors in them, like `[class^="col-"]`, are returned as patterns, since every name they match has to keep its spelling too.
function namesInExternalStylesheets (paths, warn) {
  const names = new Set()
  const patterns = []
  for (const entry of paths ?? []) {
    const files = fs.statSync(entry, { throwIfNoEntry: false })?.isDirectory() ? listFiles(entry) : [entry]
    for (const filePath of files) {
      const source = readTextFile(filePath)
      if (source === null) {
        warn(`the exempt stylesheet ${filePath} could not be read`)
        continue
      }
      const lineComments = LINE_COMMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
      scanStylesheet(source, token => {
        if (token.kind === 'pattern') patterns.push(token)
        else names.add(token.name)
      }, { lineComments })
    }
  }
  return { names, patterns }
}

// collects every class, id, and data-* name used by scripts the caller is not letting us edit, such as a library bundled in from node_modules that looks up elements by class or reads data-* attributes from the markup. renaming those names in the markup would leave the library looking for elements that no longer match.
function namesInExternalScripts (paths, jsExtensions, warn, onScriptNames) {
  const names = new Set()
  for (const entry of paths ?? []) {
    const files = fs.statSync(entry, { throwIfNoEntry: false })?.isDirectory() ? listFiles(entry).filter(filePath => hasExtension(filePath, jsExtensions)) : [entry]
    for (const filePath of files) {
      const source = readTextFile(filePath)
      if (source === null) {
        warn(`the exempt script ${filePath} could not be read`)
        continue
      }
      try {
        analyzeJs(source, token => { if (token.kind === 'class' || token.kind === 'id' || token.kind === 'data') names.add(token.name) }, { scanHtml, warn () {}, onScriptNames })
      } catch (error) {
        warn(`the exempt script ${filePath} could not be parsed, so the names it uses could not be kept: ${error.message}`)
      }
    }
  }
  return names
}

// offsets every token a nested scan reports so it lands in the outer file
function shift (collect, offset) {
  return token => collect({ ...token, start: token.start + offset, end: token.end + offset })
}

module.exports = minifyHtmlAttributes
