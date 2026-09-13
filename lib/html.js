const { splitList, isSafeName } = require('./selector')

// elements whose contents are raw text rather than markup
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'])

// attributes whose value is a single id reference
const ID_REFERENCE_ATTRIBUTES = new Set(['for', 'form', 'list', 'aria-activedescendant'])

// attributes whose value is a whitespace separated list of id references
const ID_REFERENCE_LIST_ATTRIBUTES = new Set(['headers', 'itemref', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns'])

// attributes whose value is a `#`-prefixed id reference
const FRAGMENT_REFERENCE_ATTRIBUTES = new Set(['usemap', 'href', 'xlink:href'])

// script types we should read as javascript; anything else is data or a template
const JAVASCRIPT_SCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript', 'text/babel', 'module/esm'])

const HTML_TEMPLATE_SCRIPT_TYPES = new Set(['text/html', 'text/template', 'text/x-template', 'text/x-handlebars-template'])

const EVENT_HANDLER_ATTRIBUTE = /^on[a-z]+$/

function isTagNameStart (character) {
  return character !== undefined && /[A-Za-z]/.test(character)
}

// scans an html document or fragment, reporting the attribute names and values that can be renamed and handing embedded css and js to the callbacks provided. offsets are relative to `text`.
//
// report receives { kind, name, start, end } where kind is one of 'class', 'id', 'idReference', 'data', 'attrValue', 'fragmentReference'.
function scanHtml (text, rawReport, options = {}) {
  // template languages routinely build attribute values out of expressions; anything that is not a plain name is left exactly as the author wrote it
  const report = token => { if (isSafeName(token.name)) rawReport(token) }
  const valueAttributes = options.valueAttributes ?? new Set()
  const onStyle = options.onStyle ?? (() => {})
  const onScript = options.onScript ?? (() => {})
  const onHtml = options.onHtml ?? (() => {})
  const onEventHandler = options.onEventHandler ?? (() => {})
  let index = 0

  while (index < text.length) {
    const open = text.indexOf('<', index)
    if (open === -1) break

    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4)
      index = close === -1 ? text.length : close + 3
      continue
    }

    if (text.startsWith('<![CDATA[', open)) {
      const close = text.indexOf(']]>', open + 9)
      index = close === -1 ? text.length : close + 3
      continue
    }

    if (text[open + 1] === '!' || text[open + 1] === '?' || text[open + 1] === '/') {
      const close = text.indexOf('>', open)
      index = close === -1 ? text.length : close + 1
      continue
    }

    if (!isTagNameStart(text[open + 1])) { index = open + 1; continue }

    let position = open + 1
    while (position < text.length && /[^\s/>]/.test(text[position])) position++
    const tagName = text.slice(open + 1, position).toLowerCase()

    const { attributes, end: tagEnd, selfClosing } = readAttributes(text, position)
    handleAttributes(tagName, attributes)
    index = tagEnd

    // raw text elements swallow everything up to their closing tag
    if (RAW_TEXT_ELEMENTS.has(tagName) && !selfClosing) {
      const closeTag = findClosingTag(text, tagEnd, tagName)
      const rawStart = tagEnd
      const rawEnd = closeTag === -1 ? text.length : closeTag
      const raw = text.slice(rawStart, rawEnd)
      if (tagName === 'style') onStyle(raw, rawStart)
      else if (tagName === 'script') {
        const type = (attributes.find(attribute => attribute.name.toLowerCase() === 'type')?.value ?? '').trim().toLowerCase()
        if (JAVASCRIPT_SCRIPT_TYPES.has(type)) onScript(raw, rawStart)
        else if (HTML_TEMPLATE_SCRIPT_TYPES.has(type)) onHtml(raw, rawStart)
      }
      index = rawEnd
    }
  }

  function handleAttributes (tagName, attributes) {
    for (const attribute of attributes) {
      if (attribute.valueStart === null) continue
      const name = attribute.name.toLowerCase()
      const { value, valueStart } = attribute

      if (name === 'class' && !options.disableClassReplacements) {
        for (const entry of splitList(value, valueStart)) report({ kind: 'class', name: entry.name, start: entry.start, end: entry.end })
        continue
      }

      if (name === 'id' && !options.disableIdReplacements) {
        const trimmed = value.trim()
        if (trimmed) report({ kind: 'id', name: trimmed, start: valueStart + value.indexOf(trimmed), end: valueStart + value.indexOf(trimmed) + trimmed.length })
        continue
      }

      // <map name="x"> is targeted by usemap="#x", so it shares the id namespace
      if (name === 'name' && tagName === 'map' && !options.disableIdReplacements) {
        const trimmed = value.trim()
        if (trimmed) report({ kind: 'id', name: trimmed, start: valueStart + value.indexOf(trimmed), end: valueStart + value.indexOf(trimmed) + trimmed.length })
        continue
      }

      if (name.startsWith('data-') && !options.disableDataReplacements) {
        report({ kind: 'data', name: name.slice(5), start: attribute.nameStart + 5, end: attribute.nameEnd })
        continue
      }

      if (valueAttributes.has(name)) {
        for (const entry of splitList(value, valueStart)) report({ kind: 'attrValue', attribute: name, name: entry.name, start: entry.start, end: entry.end })
        continue
      }

      if (ID_REFERENCE_ATTRIBUTES.has(name) && !options.disableIdReplacements) {
        const trimmed = value.trim()
        if (trimmed) report({ kind: 'idReference', name: trimmed, start: valueStart + value.indexOf(trimmed), end: valueStart + value.indexOf(trimmed) + trimmed.length })
        continue
      }

      if (ID_REFERENCE_LIST_ATTRIBUTES.has(name) && !options.disableIdReplacements) {
        for (const entry of splitList(value, valueStart)) report({ kind: 'idReference', name: entry.name, start: entry.start, end: entry.end })
        continue
      }

      if (FRAGMENT_REFERENCE_ATTRIBUTES.has(name) && !options.disableIdReplacements) {
        // only a bare `#fragment` is an in-page id reference; anything with a path or origin points somewhere else
        const trimmed = value.trim()
        if (trimmed.length > 1 && trimmed.startsWith('#')) {
          const offset = valueStart + value.indexOf(trimmed) + 1
          report({ kind: 'idReference', name: trimmed.slice(1), start: offset, end: offset + trimmed.length - 1 })
        }
        continue
      }

      if (EVENT_HANDLER_ATTRIBUTE.test(name)) onEventHandler(attribute)
    }
  }
}

// reads attributes from `index` until the end of the tag, returning their names, values, and offsets
function readAttributes (text, index) {
  const attributes = []
  let position = index
  let selfClosing = false

  while (position < text.length) {
    while (position < text.length && /\s/.test(text[position])) position++
    if (position >= text.length) break

    if (text[position] === '>') { position++; break }
    if (text[position] === '/' && text[position + 1] === '>') { selfClosing = true; position += 2; break }
    if (text[position] === '/') { position++; continue }

    const nameStart = position
    while (position < text.length && !/[\s=/>]/.test(text[position])) position++
    const nameEnd = position
    if (nameEnd === nameStart) { position++; continue }
    const name = text.slice(nameStart, nameEnd)

    let cursor = position
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++

    if (text[cursor] !== '=') {
      attributes.push({ name, nameStart, nameEnd, value: null, valueStart: null, valueEnd: null, quote: null })
      continue
    }

    cursor++
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++

    let value
    let valueStart
    let valueEnd
    let quote = null
    if (text[cursor] === '"' || text[cursor] === "'") {
      quote = text[cursor]
      valueStart = cursor + 1
      valueEnd = text.indexOf(quote, valueStart)
      if (valueEnd === -1) valueEnd = text.length
      value = text.slice(valueStart, valueEnd)
      position = Math.min(valueEnd + 1, text.length)
    } else {
      valueStart = cursor
      while (cursor < text.length && !/[\s>]/.test(text[cursor])) cursor++
      valueEnd = cursor
      value = text.slice(valueStart, valueEnd)
      position = cursor
    }

    attributes.push({ name, nameStart, nameEnd, value, valueStart, valueEnd, quote })
  }

  return { attributes, end: position, selfClosing }
}

// finds the offset of the matching `</tag`, ignoring the string contents that precede it
function findClosingTag (text, from, tagName) {
  const pattern = new RegExp(`</${tagName}[\\s/>]`, 'i')
  const match = pattern.exec(text.slice(from))
  return match ? from + match.index : -1
}

module.exports = { scanHtml, readAttributes, RAW_TEXT_ELEMENTS, EVENT_HANDLER_ATTRIBUTE }
