const acorn = require('acorn')
const { scanSelector, splitList, isSafeName } = require('./selector')
const { scanStylesheet } = require('./css')

// globals that must never be renamed even if an element happens to share the name, because the name already means something to the browser or the runtime. a real global wins over the implicit global an element id creates, so renaming a reference to one of these would quietly change what the code reads.
const PROTECTED_GLOBALS = new Set([
  // language built-ins
  'AggregateError', 'Array', 'ArrayBuffer', 'Atomics', 'BigInt', 'BigInt64Array', 'BigUint64Array', 'Boolean', 'DataView', 'Date',
  'Error', 'EvalError', 'FinalizationRegistry', 'Float32Array', 'Float64Array', 'Function', 'Infinity', 'Int16Array', 'Int32Array',
  'Int8Array', 'Intl', 'Iterator', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError',
  'Reflect', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol', 'SyntaxError', 'TypeError', 'URIError', 'Uint16Array',
  'Uint32Array', 'Uint8Array', 'Uint8ClampedArray', 'WeakMap', 'WeakRef', 'WeakSet', 'arguments', 'decodeURI', 'decodeURIComponent',
  'encodeURI', 'encodeURIComponent', 'escape', 'eval', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'undefined', 'unescape',
  // window properties and functions
  'alert', 'atob', 'blur', 'btoa', 'caches', 'cancelAnimationFrame', 'clearInterval', 'clearTimeout', 'close', 'closed', 'confirm',
  'console', 'createImageBitmap', 'crypto', 'customElements', 'devicePixelRatio', 'document', 'event', 'external', 'fetch', 'find',
  'focus', 'frameElement', 'frames', 'getComputedStyle', 'getSelection', 'history', 'indexedDB', 'innerHeight', 'innerWidth',
  'isSecureContext', 'length', 'localStorage', 'location', 'locationbar', 'matchMedia', 'menubar', 'moveBy', 'moveTo', 'name',
  'navigator', 'onerror', 'onload', 'open', 'opener', 'origin', 'outerHeight', 'outerWidth', 'pageXOffset', 'pageYOffset', 'parent',
  'performance', 'personalbar', 'postMessage', 'print', 'prompt', 'queueMicrotask', 'reportError', 'requestAnimationFrame',
  'requestIdleCallback', 'resizeBy', 'resizeTo', 'screen', 'screenLeft', 'screenTop', 'screenX', 'screenY', 'scroll', 'scrollBy',
  'scrollTo', 'scrollX', 'scrollY', 'scrollbars', 'self', 'sessionStorage', 'setInterval', 'setTimeout', 'speechSynthesis', 'status',
  'statusbar', 'stop', 'structuredClone', 'toolbar', 'top', 'visualViewport', 'window',
  // commonly used web api constructors
  'AbortController', 'AbortSignal', 'Audio', 'Blob', 'BroadcastChannel', 'CSS', 'CSSStyleSheet', 'CustomEvent', 'DOMParser', 'Element',
  'Event', 'EventSource', 'EventTarget', 'File', 'FileReader', 'FormData', 'HTMLElement', 'Headers', 'Image', 'IntersectionObserver',
  'MutationObserver', 'Node', 'Notification', 'Option', 'Request', 'ResizeObserver', 'Response', 'ShadowRoot', 'TextDecoder',
  'TextEncoder', 'URL', 'URLSearchParams', 'WebSocket', 'Worker', 'XMLHttpRequest',
  // module systems and node
  'Buffer', 'define', 'exports', 'global', 'module', 'process', 'require'
])

// words that cannot be used as a variable name, so an id that is referenced as a global variable must never be renamed to one of them
const RESERVED_WORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null',
  'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield'
])

// objects whose properties are globals, so `window.foo = 1` defines a global named foo
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self'])

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

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

// lists the identifiers a binding or assignment pattern writes to
function patternNames (node, names = []) {
  if (!node) return names
  switch (node.type) {
    case 'Identifier': names.push(node.name); break
    case 'ObjectPattern': for (const property of node.properties) patternNames(property.type === 'RestElement' ? property.argument : property.value, names); break
    case 'ArrayPattern': for (const element of node.elements) patternNames(element, names); break
    case 'AssignmentPattern': patternNames(node.left, names); break
    case 'RestElement': patternNames(node.argument, names); break
  }
  return names
}

// collects every name the file binds or writes to. an identifier that is bound somewhere is a program variable, never an element id we may rename, and a name that is bound outside any function, or assigned without being declared, is a global that every other script on the page can see as well.
//
// returns { declared, bindingCounts, globals, assigned, indirectlyAssigned }:
// - declared: every name bound anywhere in the file
// - bindingCounts: how many separate bindings each name has, counting parameters, so a name reused in another scope can be told apart from a true constant
// - globals: names this file makes visible to every script on the page
// - assigned: names written to outside of a declaration, through an assignment, a destructuring assignment, a for-in/of loop, or ++/--
// - indirectlyAssigned: the subset of those written any way other than a plain `name = value`
function collectBindings (ast) {
  const declared = new Set()
  const bindingCounts = new Map()
  const globals = new Set()
  const assigned = new Set()
  const indirectlyAssigned = new Set()

  function write (names, indirect) {
    for (const name of names) {
      assigned.add(name)
      if (indirect) indirectlyAssigned.add(name)
    }
  }

  function bind (name, global) {
    declared.add(name)
    bindingCounts.set(name, (bindingCounts.get(name) ?? 0) + 1)
    if (global) globals.add(name)
  }

  function visit (node, inFunction) {
    switch (node.type) {
      case 'VariableDeclarator': for (const name of patternNames(node.id)) bind(name, !inFunction); break
      case 'FunctionDeclaration':
        if (node.id) bind(node.id.name, !inFunction)
        for (const parameter of node.params) for (const name of patternNames(parameter)) bind(name, false)
        break
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) bind(node.id.name, false)
        for (const parameter of node.params) for (const name of patternNames(parameter)) bind(name, false)
        break
      case 'ClassDeclaration': if (node.id) bind(node.id.name, !inFunction); break
      case 'ClassExpression': if (node.id) bind(node.id.name, false); break
      case 'CatchClause': for (const name of patternNames(node.param)) bind(name, false); break
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
      case 'ImportSpecifier':
        bind(node.local.name, false)
        break
      case 'LabeledStatement': declared.add(node.label.name); break
      case 'AssignmentExpression':
        write(patternNames(node.left), node.left.type !== 'Identifier')
        // `window.foo = 1` defines a global just as surely as `var foo` does
        if (node.left.type === 'MemberExpression' && !node.left.computed && node.left.property.type === 'Identifier' &&
            node.left.object.type === 'Identifier' && GLOBAL_OBJECTS.has(node.left.object.name)) globals.add(node.left.property.name)
        break
      case 'ForInStatement':
      case 'ForOfStatement':
        if (node.left.type !== 'VariableDeclaration') write(patternNames(node.left), true)
        break
      case 'UpdateExpression': write(patternNames(node.argument), true); break
    }
    const childInFunction = inFunction || FUNCTION_TYPES.has(node.type)
    eachChild(node, child => visit(child, childInFunction))
  }

  visit(ast, false)
  // assigning to a name nobody declared creates a global in sloppy mode
  for (const name of assigned) if (!declared.has(name)) globals.add(name)
  return { declared, bindingCounts, globals, assigned, indirectlyAssigned }
}

// finds names that hold one string literal and nothing else, so a selector assembled from a variable can be traced back to the literal behind it. a name that is bound more than once anywhere in the file, such as a parameter that shadows the constant, or that is written to any other way, is not traced, because there is no telling which binding a given reference sees.
function collectStringConstants (ast, bindings) {
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

  for (const name of [...candidates.keys()]) {
    if ((bindings.bindingCounts.get(name) ?? 0) > 1 || bindings.indirectlyAssigned.has(name)) candidates.delete(name)
  }
  return candidates
}

// analyzes javascript source, reporting every renameable name it can prove is a class, id, or data attribute reference. offsets are relative to `source`.
function analyzeJs (source, report, options = {}) {
  const valueAttributes = options.valueAttributes ?? new Set()
  const warn = options.warn ?? (() => {})
  const scanHtml = options.scanHtml // injected by the caller to avoid a cycle

  const ast = parse(source)
  const bindings = collectBindings(ast)
  const declaredNames = bindings.declared
  const stringConstants = collectStringConstants(ast, bindings)
  const freeNames = new Set() // every name this file reads without declaring it
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
  function handleFreeIdentifier (node, parent, key, grandparent) {
    if (declaredNames.has(node.name)) return
    if (parent) {
      if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return
      if (parent.type === 'Property' && key === 'key' && !parent.computed) return
      if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) return
      if (parent.type === 'ImportSpecifier' || parent.type === 'ExportSpecifier') return
      if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return
      // `import.meta` and `new.target` are syntax, not variables
      if (parent.type === 'MetaProperty') return
    }
    freeNames.add(node.name)
    if (options.disableIdReplacements || options.disableGlobalVariableReplacements) return
    if (PROTECTED_GLOBALS.has(node.name)) return
    // a name this file assigns to is a global variable of its own, which shadows any element with the same id
    if (bindings.globals.has(node.name)) return
    // `{ foo }` is shorthand for `{ foo: foo }`, so renaming the variable must not rename the property along with it
    const shorthand = parent?.type === 'Property' && parent.shorthand && key === 'value' && grandparent?.type === 'ObjectExpression'
    // renaming this must not collide with a name the file already binds
    emit({ kind: 'globalVariable', name: node.name, start: node.start, end: node.end, fileBindings: declaredNames, rewrite: shorthand ? minified => `${node.name}: ${minified}` : undefined })
  }

  function visit (node, parent, key, grandparent) {
    switch (node.type) {
      case 'CallExpression':
      case 'NewExpression': handleCall(node); break
      case 'AssignmentExpression': handleAssignment(node); break
      case 'MemberExpression': handleMember(node); break
      case 'Identifier': handleFreeIdentifier(node, parent, key, grandparent); break
    }
    for (const childKey in node) {
      const value = node[childKey]
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item.type === 'string') visit(item, node, childKey, parent)
      } else if (value && typeof value.type === 'string') visit(value, node, childKey, parent)
    }
  }

  visit(ast, null, null, null)

  // lets the caller see the variables every script shares, so a global one script defines is never mistaken for an element id in another, and a renamed id never lands on a name some script already uses
  options.onScriptNames?.({ declared: declaredNames, globals: bindings.globals, free: freeNames })
}

module.exports = { analyzeJs, looksLikeCss, looksLikeHtml, camelToKebab, PROTECTED_GLOBALS, RESERVED_WORDS, OPAQUE }
