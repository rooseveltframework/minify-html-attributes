// scans css selector text and reports the class names, ids, and attribute names it finds, as offsets into the text it was given. it never rewrites anything itself; callers turn the reported ranges into edits.

// characters that mean the "name" is really a template placeholder of some kind (teddy `{x}`, less `@{x}`, scss `#{x}`, handlebars, jsx, and friends) or a css escape we would not round-trip safely
const UNSAFE_NAME = /[{}$@\\<>%*+&|/\s'"()[\]]/

// a name is only renameable when it is a plain identifier. anything holding template syntax, a css escape, or whitespace is left exactly as written.
function isSafeName (name) {
  return typeof name === 'string' && name.length > 0 && !UNSAFE_NAME.test(name)
}

function isIdentStart (character) {
  if (character === undefined) return false
  return /[A-Za-z_-]/.test(character) || character.charCodeAt(0) >= 0x80
}

function isIdentPart (character) {
  if (character === undefined) return false
  return /[A-Za-z0-9_-]/.test(character) || character.charCodeAt(0) >= 0x80
}

// reads a css identifier starting at index, returning the end offset or -1
function readIdent (text, index) {
  if (!isIdentStart(text[index])) return -1
  // a leading hyphen must be followed by another ident character, otherwise this is a combinator or a negative number rather than a name
  if (text[index] === '-' && !isIdentStart(text[index + 1]) && !/[0-9]/.test(text[index + 1] ?? '')) return -1
  let end = index + 1
  while (end < text.length && isIdentPart(text[end])) end++
  return end
}

// skips a quoted string starting at index (which must be the quote), returning the offset just past the closing quote
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

// substring matching operators cannot be renamed safely: `[data-x^="foo"]` still has to match values that merely begin with foo, and we have no way to know what those values are
const RENAMEABLE_OPERATORS = new Set(['=', '~='])

// splits a whitespace separated list into { name, start, end } entries
function splitList (text, offset = 0) {
  const entries = []
  const pattern = /\S+/g
  let match
  while ((match = pattern.exec(text))) entries.push({ name: match[0], start: offset + match.index, end: offset + match.index + match[0].length })
  return entries
}

// scans `text` as a css selector. `report` is called with { kind, name, start, end } for every renameable name found, where kind is one of 'class', 'id', 'data', or 'attrValue' (which also carries `attribute`).
function scanSelector (text, report, options = {}) {
  const valueAttributes = options.valueAttributes ?? new Set()
  let index = 0

  function reportName (kind, name, start, end, extra) {
    if (!isSafeName(name)) return
    report({ kind, name, start, end, ...extra })
  }

  while (index < text.length) {
    const character = text[index]

    if (character === '\\') { index += 2; continue }

    if (character === '"' || character === "'") { index = skipString(text, index); continue }

    if (character === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      index = close === -1 ? text.length : close + 2
      continue
    }

    if (character === '.' || character === '#') {
      const end = readIdent(text, index + 1)
      // `.mixin()` in less and `#namespace()` are mixin calls, not selectors
      if (end !== -1 && text[end] !== '(') {
        reportName(character === '.' ? 'class' : 'id', text.slice(index + 1, end), index + 1, end)
        index = end
        continue
      }
      index++
      continue
    }

    if (character === '[') {
      index = scanAttributeSelector(text, index, reportName, valueAttributes)
      continue
    }

    index++
  }
}

// parses `[name]`, `[name=value]`, `[name="value" i]` starting at the bracket, returning the offset just past the closing bracket
function scanAttributeSelector (text, start, reportName, valueAttributes) {
  let index = start + 1
  while (index < text.length && /\s/.test(text[index])) index++

  const nameStart = index
  // attribute names may be namespaced (`svg|href`) or vendor prefixed
  while (index < text.length && (isIdentPart(text[index]) || text[index] === '|' || text[index] === ':')) index++
  const nameEnd = index
  if (nameEnd === nameStart) return closeBracket(text, start)

  const attribute = text.slice(nameStart, nameEnd).toLowerCase()

  while (index < text.length && /\s/.test(text[index])) index++

  let operator = ''
  if (text[index] === ']') operator = ''
  else {
    const operatorStart = index
    while (index < text.length && '~^$*|='.includes(text[index])) index++
    operator = text.slice(operatorStart, index)
  }

  // `[data-foo]` renames the attribute name itself
  if (attribute.startsWith('data-')) reportName('data', attribute.slice(5), nameStart + 5, nameEnd)

  if (!operator) return closeBracket(text, start)

  while (index < text.length && /\s/.test(text[index])) index++

  // read the value, quoted or bare
  let valueStart
  let valueEnd
  if (text[index] === '"' || text[index] === "'") {
    valueStart = index + 1
    valueEnd = skipString(text, index) - 1
    index = valueEnd + 1
  } else {
    valueStart = index
    while (index < text.length && text[index] !== ']' && !/\s/.test(text[index])) index++
    valueEnd = index
  }

  if (RENAMEABLE_OPERATORS.has(operator)) {
    const value = text.slice(valueStart, valueEnd)
    if (attribute === 'class') {
      for (const entry of splitList(value, valueStart)) reportName('class', entry.name, entry.start, entry.end)
    } else if (attribute === 'id') {
      reportName('id', value.trim(), valueStart, valueEnd)
    } else if (valueAttributes.has(attribute)) {
      for (const entry of splitList(value, valueStart)) reportName('attrValue', entry.name, entry.start, entry.end, { attribute })
    }
  }

  return closeBracket(text, index)
}

function closeBracket (text, from) {
  const close = text.indexOf(']', from)
  return close === -1 ? text.length : close + 1
}

module.exports = { scanSelector, readIdent, skipString, splitList, isIdentStart, isIdentPart, isSafeName, UNSAFE_NAME }
