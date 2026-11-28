const { scanSelector, readIdent, isSafeName } = require('./selector')

// walks a stylesheet and hands each selector prelude to the selector scanner. it only ever looks for the boundaries between statements, so it works on plain css as well as on nested preprocessor dialects like less and scss.

// at-rules whose bodies contain ordinary style rules, so we keep descending
const NESTING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'document', 'when'])

function skipString (text, index) {
  const quote = text[index]
  let position = index + 1
  while (position < text.length) {
    if (text[position] === '\\') position += 2
    else if (text[position] === quote) return position + 1
    else position++
  }
  return position
}

// skips a balanced parenthesized run so that braces inside `url(...)` or a data uri cannot be mistaken for a rule body
function skipParens (text, index) {
  let depth = 0
  let position = index
  while (position < text.length) {
    const character = text[position]
    if (character === '\\') { position += 2; continue }
    if (character === '"' || character === "'") { position = skipString(text, position); continue }
    if (character === '(') { depth++; position++; continue }
    if (character === ')') {
      depth--
      position++
      if (depth === 0) return position
      continue
    }
    position++
  }
  return position
}

// skips a balanced `#{…}` or `@{…}` interpolation starting at the sigil, returning the offset just past its closing brace
function skipInterpolation (text, index) {
  let depth = 0
  let position = index + 1
  while (position < text.length) {
    const character = text[position]
    if (character === '"' || character === "'") { position = skipString(text, position); continue }
    if (character === '{') depth++
    else if (character === '}' && --depth === 0) return position + 1
    position++
  }
  return position
}

function isInterpolation (text, index) {
  return (text[index] === '#' || text[index] === '@') && text[index + 1] === '{'
}

// returns a copy of `text` with every comment replaced by spaces, so that the scanners never mistake a comment for code while every offset still lines up with the original. strings and parenthesized runs are copied as they are, since `//` inside `url(//cdn…)` is not a comment.
function blankComments (text, lineComments) {
  let result = ''
  let index = 0
  const blank = run => run.replace(/[^\n]/g, ' ')
  while (index < text.length) {
    const character = text[index]
    let end = index + 1
    if (character === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      end = close === -1 ? text.length : close + 2
      result += blank(text.slice(index, end))
    } else if (lineComments && character === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index)
      end = newline === -1 ? text.length : newline
      result += blank(text.slice(index, end))
    } else {
      if (character === '"' || character === "'") end = skipString(text, index)
      else if (character === '(') end = skipParens(text, index)
      result += text.slice(index, end)
    }
    index = end
  }
  return result
}

// reports `url(#someId)`, which svg paint servers, clip paths, masks, filters, and markers use to point at an element by id. offsets are relative to `text`.
function scanUrlReferences (text, report, offset = 0) {
  const pattern = /url\(\s*(["']?)#/gi
  let match
  while ((match = pattern.exec(text))) {
    const start = match.index + match[0].length
    const end = readIdent(text, start)
    if (end === -1) continue
    // the name has to be all there is, or it is something we cannot see the whole of
    const after = text[end]
    if (match[1] ? after !== match[1] : !(after === ')' || /\s/.test(after ?? ''))) continue
    const name = text.slice(start, end)
    if (isSafeName(name)) report({ kind: 'idReference', name, start: offset + start, end: offset + end })
  }
}

// splits a selector list on its top-level commas, returning { text, start } for each selector
function splitSelectorList (prelude) {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index < prelude.length; index++) {
    const character = prelude[index]
    if (character === '"' || character === "'") { index = skipString(prelude, index) - 1; continue }
    if (character === '(' || character === '[') depth++
    else if (character === ')' || character === ']') depth--
    else if (character === ',' && depth === 0) {
      parts.push({ text: prelude.slice(start, index), start })
      start = index + 1
    }
  }
  parts.push({ text: prelude.slice(start), start })
  return parts
}

// a mixin call in less is a bare selector used as a statement, like `.rounded;` or `#ns > .mixin();`
const MIXIN_CALL = /^\s*((?:[.#][A-Za-z_-][\w-]*\s*>?\s*)+)(?:\([^]*\))?\s*(?:!important)?\s*$/

// `report` receives { kind, name, start, end } with offsets into `text`, plus { kind: 'pattern', namespace, match, name } for names that must keep their original spelling, where match is 'exact', 'prefix', 'suffix', or 'contains'
function scanStylesheet (text, report, options = {}) {
  const warn = options.warn ?? (() => {})
  const clean = blankComments(text, options.lineComments ?? false)
  let index = 0
  let statementStart = 0

  // for each open block, the class or id names that `&` stands for inside it, as { namespace, name }, or null when they cannot be known
  const parents = [[]]

  const reportAt = offset => token => report({ ...token, start: token.start + offset, end: token.end + offset })
  const keep = (namespace, name, at) => {
    if (isSafeName(name)) report({ kind: 'pattern', namespace, match: 'exact', name, start: at, end: at })
  }

  // works out what `&` stands for in the block a selector opens, and keeps every name that `&-suffix` builds out of its parent at its original spelling, along with the parent itself: neither can be renamed without the other, and the built name never appears in the source
  function resolveNesting (prelude, offset) {
    const outer = parents[parents.length - 1]
    const trailing = []
    let unknown = false
    for (const part of splitSelectorList(prelude)) {
      const concatenation = /&([\w-]+)/g
      let match
      while ((match = concatenation.exec(part.text))) {
        const suffix = match[1]
        if (!outer || !outer.length) {
          warn(`selector "${part.text.trim().replace(/\s+/g, ' ').slice(0, 80)}" concatenates onto a parent selector whose name cannot be worked out; the names it builds cannot be renamed safely, so add them to exemptNames`)
          continue
        }
        for (const parent of outer) {
          keep(parent.namespace, parent.name, offset + part.start + match.index)
          keep(parent.namespace, parent.name + suffix, offset + part.start + match.index)
        }
        const names = outer.flatMap(parent => [`"${parent.name}"`, `"${parent.name}${suffix}"`])
        warn(`selector "${part.text.trim().replace(/\s+/g, ' ').slice(0, 80)}" builds a name out of its parent with "&", so ${names.join(', ')} keep their original spelling`)
      }

      // what this selector ends with, which is what `&` will stand for one level further in
      const last = /(&[\w-]*|[.#][A-Za-z_-][\w-]*)\s*$/.exec(part.text)
      if (!last) { unknown = true; continue }
      if (last[1].startsWith('&')) {
        if (!outer) { unknown = true; continue }
        for (const parent of outer) trailing.push({ namespace: parent.namespace, name: parent.name + last[1].slice(1) })
      } else {
        trailing.push({ namespace: last[1][0] === '.' ? 'class' : 'id', name: last[1].slice(1) })
      }
    }
    return unknown ? null : trailing
  }

  function scanPrelude (prelude, offset) {
    const trimmed = prelude.trim()
    if (trimmed.startsWith('@')) {
      // at-rule preludes hold media queries and the like, not selectors, but `@scope (.a) to (.b)` is an exception worth handling
      const atRule = /^@([\w-]+)/.exec(trimmed)?.[1]?.toLowerCase()
      if (atRule === 'scope') scanSelector(prelude, reportAt(offset), options)
      // `&` inside `@media` still means the selector outside it
      parents.push(atRule && NESTING_AT_RULES.has(atRule) ? parents[parents.length - 1] : [])
      return
    }
    parents.push(resolveNesting(prelude, offset))
    scanSelector(prelude, reportAt(offset), options)
  }

  function scanStatement (statement, offset) {
    // `@extend .foo;` references a selector from inside a declaration block
    const extend = /^\s*@extend\b/.exec(statement)
    if (extend) {
      scanSelector(statement.slice(extend[0].length), reportAt(offset + extend[0].length), options)
      return
    }
    // less mixin calls refer to a rule by its selector, and `.mixin()` may call a rule written without parentheses, so a name that is called as a mixin keeps its spelling everywhere rather than being renamed in the definition but not the call
    const mixin = MIXIN_CALL.exec(statement)
    if (mixin) {
      for (const name of mixin[1].matchAll(/([.#])([A-Za-z_-][\w-]*)/g)) keep(name[1] === '.' ? 'class' : 'id', name[2], offset + name.index)
    }
  }

  while (index < clean.length) {
    const character = clean[index]

    if (character === '"' || character === "'") { index = skipString(clean, index); continue }

    // `#{$name}` in scss and `@{name}` in less are interpolations, not rule bodies
    if (isInterpolation(clean, index)) { index = skipInterpolation(clean, index); continue }

    if (character === '(') {
      const end = skipParens(clean, index)
      if (/url$/i.test(clean.slice(Math.max(0, index - 3), index))) scanUrlReferences(clean.slice(index - 3, end), report, index - 3)
      index = end
      continue
    }

    if (character === '{') {
      scanPrelude(clean.slice(statementStart, index), statementStart)
      index++
      statementStart = index
      continue
    }

    if (character === '}' || character === ';') {
      scanStatement(clean.slice(statementStart, index), statementStart)
      if (character === '}' && parents.length > 1) parents.pop()
      index++
      statementStart = index
      continue
    }

    index++
  }
}

module.exports = { scanStylesheet, scanUrlReferences, blankComments }
