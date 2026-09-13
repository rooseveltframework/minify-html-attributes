const { scanSelector } = require('./selector')

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

// `report` receives { kind, name, start, end } with offsets into `text`
function scanStylesheet (text, report, options = {}) {
  const lineComments = options.lineComments ?? false
  const warn = options.warn ?? (() => {})
  let index = 0
  let statementStart = 0

  const reportAt = offset => token => report({ ...token, start: token.start + offset, end: token.end + offset })

  function scanPrelude (prelude, offset) {
    const trimmed = prelude.trim()
    if (trimmed.startsWith('@')) {
      // at-rule preludes hold media queries and the like, not selectors, but `@scope (.a) to (.b)` is an exception worth handling
      const atRule = /^@([\w-]+)/.exec(trimmed)?.[1]?.toLowerCase()
      if (atRule === 'scope') scanSelector(prelude, reportAt(offset), options)
      else if (atRule && !NESTING_AT_RULES.has(atRule)) return
      return
    }
    // `&-suffix` in less/scss builds a class name we cannot see, so renaming the parent alone would silently break it
    if (/&[\w-]/.test(prelude)) warn(`selector "${trimmed.replace(/\s+/g, ' ').slice(0, 80)}" concatenates onto its parent with "&"; names built this way cannot be renamed safely and were left alone`)
    scanSelector(prelude, reportAt(offset), options)
  }

  while (index < text.length) {
    const character = text[index]

    if (character === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      index = close === -1 ? text.length : close + 2
      continue
    }

    if (lineComments && character === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index)
      index = newline === -1 ? text.length : newline + 1
      continue
    }

    if (character === '"' || character === "'") { index = skipString(text, index); continue }

    if (character === '(') { index = skipParens(text, index); continue }

    if (character === '{') {
      scanPrelude(text.slice(statementStart, index), statementStart)
      index++
      statementStart = index
      continue
    }

    if (character === '}' || character === ';') {
      // `@extend .foo;` and less' `:extend()` reference selectors from inside a declaration block
      const statement = text.slice(statementStart, index)
      const extend = /^\s*@extend\b/.exec(statement)
      if (extend) scanSelector(statement.slice(extend[0].length), reportAt(statementStart + extend[0].length), options)
      index++
      statementStart = index
      continue
    }

    index++
  }
}

module.exports = { scanStylesheet }
