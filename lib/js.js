const acorn = require('acorn')
const { scanSelector, splitList, isSafeName } = require('./selector')
const { scanStylesheet } = require('./css')

// globals that must never be renamed even if an element happens to share the name, because renaming them would break the program outright
const PROTECTED_GLOBALS = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'Function', 'Infinity', 'JSON', 'Map', 'Math', 'NaN', 'Number',
  'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'WeakMap', 'WeakSet',
  'alert', 'arguments', 'confirm', 'console', 'customElements', 'define', 'document', 'exports', 'fetch',
  'globalThis', 'history', 'localStorage', 'location', 'module', 'navigator', 'parent', 'process',
  'prompt', 'require', 'screen', 'self', 'sessionStorage', 'setInterval', 'setTimeout', 'clearInterval',
  'clearTimeout', 'queueMicrotask', 'requestAnimationFrame', 'structuredClone', 'top', 'undefined', 'window'
])

const SELECTOR_METHODS = new Set(['querySelector', 'querySelectorAll', 'closest', 'matches', 'webkitMatchesSelector', 'msMatchesSelector'])
const CLASS_LIST_ALL_ARGUMENTS = new Set(['add', 'remove', 'replace'])
const CLASS_LIST_FIRST_ARGUMENT = new Set(['toggle', 'contains'])
const ATTRIBUTE_NAME_METHODS = new Set(['getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute', 'toggleAttribute', 'getAttributeNode'])
// `replace` is deliberately absent: it would be indistinguishable from `classList.replace`, and guessing wrong would corrupt class names
const STYLE_SHEET_METHODS = new Set(['insertRule', 'replaceSync', 'appendRule'])
const HTML_PROPERTIES = new Set(['innerHTML', 'outerHTML'])
const TEXT_PROPERTIES = new Set(['textContent', 'innerText'])

// stands in for a runtime value we cannot see through when stitching an expression back together. it is not a valid character in any name we rename, so scanners stop cleanly when they reach it.
const OPAQUE = '\u0000'

// a string is only treated as a stylesheet when it really looks like one, so that json and other brace-bearing text is left alone
function looksLikeCss (text) {
  return /[.#][A-Za-z_-][\w-]*[^{}]*\{[^{}]*:[^{}]*[;}]/.test(text)
}

// a string is only treated as markup when it contains something shaped like a tag with attributes
function looksLikeHtml (text) {
  return /<[A-Za-z][\w-]*(\s[^<>]*)?>/.test(text)
}

const KIND_LABELS = { class: 'a class name', id: 'an id', data: 'a data attribute name', attrValue: 'an attribute value' }

// renders a partially resolved name for a warning, with the parts we could not see shown as an ellipsis. returns null when there was no name there at all.
function describe (text, token) {
  const from = text.lastIndexOf(' ', token.start) + 1
  const to = text.indexOf(' ', token.end)
  const shown = text.slice(from, to === -1 ? text.length : to).replaceAll(OPAQUE, '\u2026')
  return shown === '\u2026' ? null : shown
}

function camelToKebab (name) {
  return name.replace(/([A-Z])/g, '-$1').toLowerCase()
}

// walks every child node of an acorn ast node
function eachChild (node, visit) {
  for (const key in node) {
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === 'string') visit(item)
    } else if (value && typeof value.type === 'string') visit(value)
  }
}

function parse (source) {
  const shared = {
    ecmaVersion: 'latest',
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowImportExportEverywhere: true
  }
  try {
    return acorn.parse(source, { ...shared, sourceType: 'module' })
  } catch (moduleError) {
    try {
      return acorn.parse(source, { ...shared, sourceType: 'script' })
    } catch {
      throw moduleError
    }
  }
}

// collects every name bound anywhere in the file. an identifier that is bound somewhere is a program variable, never an element id we may rename.
function collectDeclaredNames (ast) {
  const declared = new Set()

  function bindPattern (node) {
    if (!node) return
    switch (node.type) {
      case 'Identifier': declared.add(node.name); break
      case 'ObjectPattern': for (const property of node.properties) bindPattern(property.type === 'RestElement' ? property.argument : property.value); break
      case 'ArrayPattern': for (const element of node.elements) bindPattern(element); break
      case 'AssignmentPattern': bindPattern(node.left); break
      case 'RestElement': bindPattern(node.argument); break
      case 'Property': bindPattern(node.value); break
    }
  }

  function visit (node) {
    switch (node.type) {
      case 'VariableDeclarator': bindPattern(node.id); break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) declared.add(node.id.name)
        for (const parameter of node.params) bindPattern(parameter)
        break
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) declared.add(node.id.name)
        break
      case 'CatchClause': bindPattern(node.param); break
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
      case 'ImportSpecifier':
        declared.add(node.local.name)
        break
      case 'LabeledStatement': declared.add(node.label.name); break
    }
    eachChild(node, visit)
  }

  visit(ast)
  return declared
}

// finds names that are assigned a string literal exactly once, so a selector assembled from a variable can be traced back to the literal behind it
function collectStringConstants (ast) {
  const candidates = new Map()
  const rejected = new Set()

  function record (name, value) {
    if (rejected.has(name)) return
    if (candidates.has(name)) { candidates.delete(name); rejected.add(name); return }
    if (value && value.type === 'Literal' && typeof value.value === 'string') candidates.set(name, value)
    else rejected.add(name)
  }

  function visit (node) {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') record(node.id.name, node.init)
    else if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') record(node.left.name, node.operator === '=' ? node.right : null)
    eachChild(node, visit)
  }

  visit(ast)
  return candidates
}

// analyzes javascript source, reporting every renameable name it can prove is a class, id, or data attribute reference. offsets are relative to `source`.
function analyzeJs (source, report, options = {}) {
  const valueAttributes = options.valueAttributes ?? new Set()
  const warn = options.warn ?? (() => {})
  const scanHtml = options.scanHtml // injected by the caller to avoid a cycle

  const ast = parse(source)
  const declaredNames = collectDeclaredNames(ast)
  const stringConstants = collectStringConstants(ast)
  const reported = new Set() // dedupes tokens when one constant is used twice

  function emit (token) {
    if (token.name.includes(OPAQUE) || !isSafeName(token.name)) return
    const key = `${token.start}:${token.end}:${token.kind}`
    if (reported.has(key)) return
    reported.add(key)
    report(token)
  }

  // turns an expression into the literal text fragments it is built from, with the source offset of each fragment so edits can be mapped back
  function resolvePieces (node, depth = 0) {
    if (!node || depth > 4) return [{ text: OPAQUE, start: null }]
    switch (node.type) {
      case 'Literal':
        if (typeof node.value !== 'string') return [{ text: OPAQUE, start: null }]
        return [{ text: source.slice(node.start + 1, node.end - 1), start: node.start + 1 }]
      case 'TemplateLiteral': {
        const pieces = []
        for (let index = 0; index < node.quasis.length; index++) {
          const quasi = node.quasis[index]
          pieces.push({ text: source.slice(quasi.start, quasi.end), start: quasi.start })
          if (node.expressions[index]) pieces.push(...resolvePieces(node.expressions[index], depth + 1))
        }
        return pieces
      }
      case 'BinaryExpression':
        if (node.operator !== '+') return [{ text: OPAQUE, start: null }]
        return [...resolvePieces(node.left, depth + 1), ...resolvePieces(node.right, depth + 1)]
      case 'Identifier': {
        const constant = stringConstants.get(node.name)
        if (!constant) return [{ text: OPAQUE, start: null }]
        return resolvePieces(constant, depth + 1)
      }
      default:
        return [{ text: OPAQUE, start: null }]
    }
  }

  // stitches pieces into one string and provides a way back to source offsets
  function joinPieces (pieces) {
    let text = ''
    const spans = []
    for (const piece of pieces) {
      spans.push({ start: text.length, end: text.length + piece.text.length, sourceStart: piece.start })
      text += piece.text
    }
    return {
      text,
      mapRange (start, end) {
        for (const span of spans) {
          if (start >= span.start && end <= span.end) {
            if (span.sourceStart === null) return null
            return { start: span.sourceStart + (start - span.start), end: span.sourceStart + (end - span.start) }
          }
        }
        return null // the name straddles a concatenation boundary
      }
    }
  }

  // resolves an expression, runs `scan` over the stitched text, and maps whatever it reports back onto the source
  function withResolved (node, scan) {
    if (!node) return
    if (node.type === 'ConditionalExpression') {
      withResolved(node.consequent, scan)
      withResolved(node.alternate, scan)
      return
    }
    const { text, mapRange } = joinPieces(resolvePieces(node))
    if (!text || text === OPAQUE) return
    scan(text, token => {
      // a name that runs up against a value we cannot see is only part of a name, and renaming part of a name would be worse than renaming none
      if (token.name.includes(OPAQUE) || text[token.start - 1] === OPAQUE || text[token.end] === OPAQUE) {
        const shown = describe(text, token)
        if (shown) warn(`"${shown}" is built from a value only known at runtime and was left alone`)
        return
      }
      const range = mapRange(token.start, token.end)
      if (!range) {
        warn(`"${token.name}" is split across more than one expression and was left alone`)
        return
      }
      emit({ ...token, start: range.start, end: range.end })
    })
  }

  const handleSelector = node => withResolved(node, (text, forward) => scanSelector(text, forward, { valueAttributes }))

  const handleCss = node => withResolved(node, (text, forward) => {
    if (looksLikeCss(text)) scanStylesheet(text, forward, { valueAttributes, warn })
  })

  const handleHtml = node => withResolved(node, (text, forward) => {
    if (!looksLikeHtml(text) || !scanHtml) return
    scanHtml(text, forward, {
      ...options,
      valueAttributes,
      onStyle: (css, offset) => scanStylesheet(css, token => forward({ ...token, start: token.start + offset, end: token.end + offset }), { valueAttributes, warn }),
      onScript: () => warn('a <script> tag nested inside a javascript string was left alone'),
      onEventHandler: () => {}
    })
  })

  // a whitespace separated list of class names
  const handleClassList = node => withResolved(node, (text, forward) => {
    for (const entry of splitList(text)) forward({ kind: 'class', name: entry.name, start: entry.start, end: entry.end })
  })

  // the whole value is one name
  const handleSingleName = (node, kind, attribute) => withResolved(node, (text, forward) => {
    // the whole value is the name here, so any part of it we cannot see makes the whole thing unknowable
    if (text.includes(OPAQUE)) {
      warn(`${KIND_LABELS[kind] ?? 'a name'} built from a value only known at runtime was left alone`)
      return
    }
    const trimmed = text.trim()
    if (!trimmed) return
    const start = text.indexOf(trimmed)
    forward({ kind, attribute, name: trimmed, start, end: start + trimmed.length })
  })

  // `getAttribute('data-foo')` and friends: only the `data-` prefixed name is ours to rename
  const handleAttributeName = node => withResolved(node, (text, forward) => {
    if (text.includes(OPAQUE)) return
    const trimmed = text.trim()
    if (!trimmed.toLowerCase().startsWith('data-')) return
    const start = text.indexOf(trimmed) + 5
    forward({ kind: 'data', name: trimmed.slice(5).toLowerCase(), start, end: start + trimmed.length - 5 })
  })

  function isClassListObject (node) {
    return node?.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier' && node.property.name === 'classList'
  }

  function handleCall (node) {
    const callee = node.callee
    if (!callee || callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return
    const method = callee.property.name
    const args = node.arguments

    if (SELECTOR_METHODS.has(method)) { handleSelector(args[0]); return }
    if (method === 'getElementById') { handleSingleName(args[0], 'id'); return }
    if (method === 'getElementsByClassName') { handleClassList(args[0]); return }

    if (ATTRIBUTE_NAME_METHODS.has(method)) {
      handleAttributeName(args[0])
      if (method === 'setAttribute' && args[0]?.type === 'Literal' && typeof args[0].value === 'string') {
        const attribute = args[0].value.toLowerCase()
        if (attribute === 'class') handleClassList(args[1])
        else if (attribute === 'id') handleSingleName(args[1], 'id')
        else if (valueAttributes.has(attribute)) handleClassList(args[1])
      }
      return
    }

    if (method === 'insertAdjacentHTML') { handleHtml(args[1]); return }

    if ((method === 'write' || method === 'writeln') && callee.object.type === 'Identifier' && callee.object.name === 'document') {
      for (const argument of args) handleHtml(argument)
      return
    }

    if (isClassListObject(callee.object)) {
      if (CLASS_LIST_ALL_ARGUMENTS.has(method)) for (const argument of args) handleSingleName(argument, 'class')
      else if (CLASS_LIST_FIRST_ARGUMENT.has(method)) handleSingleName(args[0], 'class')
      return
    }

    if (STYLE_SHEET_METHODS.has(method)) handleCss(args[0])
  }

  function handleAssignment (node) {
    const target = node.left
    if (target.type !== 'MemberExpression' || target.computed || target.property.type !== 'Identifier') return
    const property = target.property.name

    if (property === 'className') { handleClassList(node.right); return }
    if (property === 'value' && isClassListObject(target.object)) { handleClassList(node.right); return }
    if (property === 'id') { handleSingleName(node.right, 'id'); return }
    if (HTML_PROPERTIES.has(property)) { handleHtml(node.right); return }
    if (TEXT_PROPERTIES.has(property)) handleCss(node.right)
  }

  function handleMember (node) {
    const object = node.object

    // `element.dataset.fooBar` and `element.dataset['foo-bar']`
    if (object.type === 'MemberExpression' && !object.computed && object.property.type === 'Identifier' && object.property.name === 'dataset') {
      if (!node.computed && node.property.type === 'Identifier') {
        emit({ kind: 'data', name: camelToKebab(node.property.name), start: node.property.start, end: node.property.end })
      } else if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') {
        handleSingleName(node.property, 'data')
      }
      return
    }

    // `document.forms.myform` indexes by id as well as by name
    if (object.type === 'MemberExpression' && !object.computed && object.property.type === 'Identifier' && object.property.name === 'forms' &&
        object.object.type === 'Identifier' && object.object.name === 'document') {
      if (!node.computed && node.property.type === 'Identifier') emit({ kind: 'id', name: node.property.name, start: node.property.start, end: node.property.end })
      else if (node.computed) handleSingleName(node.property, 'id')
    }
  }

  // an identifier that is never declared in this file and is not a known global may be the implicit global the browser creates for `id="whatever"`
  function handleFreeIdentifier (node, parent, key) {
    if (options.disableIdReplacements || options.disableGlobalVariableReplacements) return
    if (declaredNames.has(node.name) || PROTECTED_GLOBALS.has(node.name)) return
    if (parent) {
      if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return
      if (parent.type === 'Property' && key === 'key' && !parent.computed) return
      if (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') return
      if (parent.type === 'ImportSpecifier' || parent.type === 'ExportSpecifier') return
      if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return
    }
    // renaming this must not collide with a name the file already binds
    emit({ kind: 'globalVariable', name: node.name, start: node.start, end: node.end, avoid: declaredNames })
  }

  function visit (node, parent, key) {
    switch (node.type) {
      case 'CallExpression':
      case 'NewExpression': handleCall(node); break
      case 'AssignmentExpression': handleAssignment(node); break
      case 'MemberExpression': handleMember(node); break
      case 'Identifier': handleFreeIdentifier(node, parent, key); break
    }
    for (const childKey in node) {
      const value = node[childKey]
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item.type === 'string') visit(item, node, childKey)
      } else if (value && typeof value.type === 'string') visit(value, node, childKey)
    }
  }

  visit(ast, null, null)
}

module.exports = { analyzeJs, looksLikeCss, looksLikeHtml, camelToKebab, PROTECTED_GLOBALS, OPAQUE }
