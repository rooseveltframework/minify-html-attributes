const fs = require('fs')
const path = require('path')
const postcss = require('postcss')
const cheerio = require('cheerio')
const acorn = require('acorn')
const estraverse = require('estraverse')
const escodegen = require('escodegen')

function loopThroughFilesSync (dir) {
  let fileList = []
  let files
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    return fileList
  }
  files.forEach(file => {
    const filePath = path.join(dir, file.name)
    if (file.isDirectory()) fileList = fileList.concat(loopThroughFilesSync(filePath)) // recurse dirs
    else if (file.isFile() && !file.name.startsWith('.')) fileList.push(filePath) // exclude hidden files
  })
  return fileList
}

function isBinaryFile (filePath, bytesToCheck = 512) {
  const buffer = Buffer.alloc(bytesToCheck)
  const fd = fs.openSync(filePath, 'r')
  const bytesRead = fs.readSync(fd, buffer, 0, bytesToCheck, 0)
  fs.closeSync(fd)
  for (let i = 0; i < bytesRead; i++) {
    const byte = buffer[i]
    if (byte === 0) return true // null byte found, likely a binary file
    else if ((byte < 32 || byte > 126) && byte !== 10 && byte !== 13 && byte !== 9) return true // non-printable ascii character found, likely a binary file; allow common control characters: \n (10), \r (13), \t (9)
  }
  return false
}

function toCamelCase (str) {
  return str.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase())
}

// generator function to produce a sequence of unique, minified names sequentially
function * generateMinifiedNames () {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let length = 1
  let index = 0
  const usedNames = new Set()

  while (true) {
    const maxIndex = Math.pow(chars.length, length)
    if (index >= maxIndex) {
      index = 0
      length++
    }

    let name = ''
    let temp = index
    for (let j = 0; j < length; j++) {
      name = chars[temp % chars.length] + name
      temp = Math.floor(temp / chars.length)
    }

    if (!usedNames.has(name)) {
      usedNames.add(name)
      yield name
    }

    index++
  }
}

function minifyHtmlAttributes (params) {
  const minifiedNameGenerator = generateMinifiedNames() // create an instance of the name generator
  const nameMap = {} // store the mapping of original -> minified names
  let attrsToRename = ['class', 'id'] // default attributes to rename (aside from data-* attrs)
  if (params?.extraAttributes) for (const attr of params?.extraAttributes) attrsToRename.push(attr) // allow user to set additional ones
  if (params?.disableClassReplacements) attrsToRename = attrsToRename.filter(item => item !== 'class')
  if (params?.disableIdReplacements) attrsToRename = attrsToRename.filter(item => item !== 'id')

  // replaces original names with their new names
  function replaceNames (content) {
    for (const [original, minified] of Object.entries(nameMap)) {
      const regex = new RegExp(`\\b${original}\\b`, 'g')
      content = content.replace(regex, minified)
    }
    return content
  }

  function processHtmlContent (html) {
    const $ = cheerio.load(html, { xml: { xmlMode: false, lowerCaseAttributeNames: false, decodeEntities: false } })
    $('*').each((i, el) => {
      const attributes = $(el).attr()
      for (const attr in attributes) {
        if (attrsToRename.includes(attr) || (attr.startsWith('data-') && !params?.disableDataReplacements)) {
          const values = attributes[attr].split(' ')
          const newValues = values.map(value => {
            if (params?.exemptNames?.includes(value)) return value
            if (!nameMap[value]) {
              const minified = minifiedNameGenerator.next().value
              nameMap[value] = minified
            }
            return nameMap[value]
          })
          $(el).attr(attr, newValues.join(' '))
        }
      }
    })

    // process inline css
    $('style').each((i, el) => {
      const css = $(el).html()
      const result = processCssContent(css)
      $(el).html(result)
    })

    // process inline js
    $('script').each((i, el) => {
      const js = $(el).html()
      const result = processJsContent(js)
      $(el).html(result)
    })

    // update ids for any element with these attributes to match the new names
    const attributesToUpdate = ['aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-labelledby', 'aria-owns', 'for', 'form', 'headers', 'itemref', 'list', 'usemap']
    $('*').each((i, el) => {
      const attributes = $(el).attr()
      for (const attr of attributesToUpdate) {
        if (attributes[attr]) {
          const values = attributes[attr].split(' ')
          const newValues = values.map(value => nameMap[value] || value)
          $(el).attr(attr, newValues.join(' '))
        }
      }
    })

    // process event handler attributes as inline js
    const eventHandlerAttributesToUpdate = ['onabort', 'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'oncontextmenu', 'oncopy', 'oncut', 'ondblclick', 'ondrag', 'ondragend', 'ondragenter', 'ondragexit', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'ondurationchange', 'onemptied', 'onended', 'onerror', 'onfocus', 'oninput', 'oninvalid', 'onkeydown', 'onkeypress', 'onkeyup', 'onload', 'onloadeddata', 'onloadedmetadata', 'onloadstart', 'onmousedown', 'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout', 'onmouseover', 'onmouseup', 'onpaste', 'onpause', 'onplay', 'onplaying', 'onprogress', 'onratechange', 'onreset', 'onscroll', 'onseeked', 'onseeking', 'onselect', 'onshow', 'onsort', 'onstalled', 'onsubmit', 'onsuspend', 'ontimeupdate', 'ontoggle', 'onunload', 'onvolumechange', 'onwaiting', 'onwheel']
    $('*').each((i, el) => {
      const attributes = $(el).attr()
      for (const attr of eventHandlerAttributesToUpdate) {
        if (attributes[attr]) {
          const js = attributes[attr]
          const result = processJsContent(js)
          $(el).attr(attr, result)
        }
      }
    })

    return $.html()
  }

  function processCssContent (css) {
    const root = postcss.parse(css)

    root.walkRules(rule => {
      rule.selectors = rule.selectors.map(selector => {
        return selector.replace(/\.([a-zA-Z0-9_-]+)/g, (match, className) => {
          if (!nameMap[className]) {
            const minified = minifiedNameGenerator.next().value
            nameMap[className] = minified
          }
          return `.${nameMap[className]}`
        }).replace(/#([a-zA-Z0-9_-]+)/g, (match, id) => {
          if (!nameMap[id]) {
            const minified = minifiedNameGenerator.next().value
            nameMap[id] = minified
          }
          return `#${nameMap[id]}`
        })
      })
    })

    root.walkDecls(decl => {
      if (decl.value.includes('attr(')) {
        decl.value = replaceNames(decl.value)
      }
      if (decl.prop.startsWith('--')) {
        decl.value = replaceNames(decl.value)
      }
    })

    return root.toString()
  }

  function processJsContent (js) {
    const ast = acorn.parse(js, { ecmaVersion: 2020 })

    estraverse.replace(ast, {
      enter (node) {
        if (node.type === 'Literal' && typeof node.value === 'string') {
          // check if the string contains html or css
          if (node.value.trim().startsWith('<') && node.value.trim().endsWith('>')) {
            node.value = processHtmlContent(node.value)
          } else if (node.value.trim().includes('{') && node.value.trim().includes('}')) {
            node.value = processCssContent(node.value)
          } else {
            node.value = replaceNames(node.value)
          }
        }
        if (node.type === 'TemplateLiteral') {
          node.quasis.forEach(quasi => {
            if (quasi.value.raw.trim().startsWith('<') && quasi.value.raw.trim().endsWith('>')) {
              quasi.value.raw = processHtmlContent(quasi.value.raw)
              quasi.value.cooked = processHtmlContent(quasi.value.cooked)
            } else if (quasi.value.raw.trim().includes('{') && quasi.value.raw.trim().includes('}')) {
              quasi.value.raw = processCssContent(quasi.value.raw)
              quasi.value.cooked = processCssContent(quasi.value.cooked)
            } else {
              quasi.value.raw = replaceNames(quasi.value.raw)
              quasi.value.cooked = replaceNames(quasi.value.cooked)
            }
          })
        }
        if (node.type === 'BinaryExpression' && node.operator === '+') {
          if (node.left.type === 'Literal' && typeof node.left.value === 'string') {
            node.left.value = replaceNames(node.left.value)
          }
          if (node.right.type === 'Literal' && typeof node.right.value === 'string') {
            node.right.value = replaceNames(node.right.value)
          }
        }
        if (node.type === 'Identifier') {
          const identifierName = node.name
          if (nameMap[identifierName]) {
            node.name = nameMap[identifierName]
          }
        }
        if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
          const propertyName = node.property.name
          if (nameMap[propertyName]) {
            node.property.name = nameMap[propertyName]
          }
        }
        if (node.type === 'MemberExpression' && node.object.type === 'MemberExpression' && node.object.property.name === 'dataset') {
          const dataAttrName = node.property.name
          const originalAttrName = `data-${dataAttrName.replace(/([A-Z])/g, '-$1').toLowerCase()}`
          if (nameMap[originalAttrName]) {
            node.property.name = nameMap[originalAttrName]
          }
        }
        if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'querySelector') {
          const arg = node.arguments[0]
          if (arg && arg.type === 'Literal' && arg.value.includes('[') && arg.value.includes(']')) {
            const attrName = arg.value.match(/\[([^\]]+)\]/)[1]
            if (nameMap[attrName]) {
              const minifiedAttrName = nameMap[attrName]
              arg.value = arg.value.replace(attrName, minifiedAttrName)
              const camelCaseAttrName = toCamelCase(minifiedAttrName.replace(/^data-/, ''))
              if (node.parent && node.parent.type === 'MemberExpression' && node.parent.property.type === 'Identifier' && node.parent.property.name === attrName) {
                node.parent.property.name = camelCaseAttrName
              }
            }
          }
        }
      }
    })

    return escodegen.generate(ast)
  }

  const htmlFiles = []
  const cssFiles = []
  const jsFiles = []
  const editedFiles = {}

  // gather list of potential html files to edit
  const potentialHtmlFiles = loopThroughFilesSync(params?.htmlDir)
  for (const file of potentialHtmlFiles) {
    if (!isBinaryFile(file)) {
      htmlFiles.push(file)
    }
  }

  // gather list of potential css files to edit
  const potentialCssFiles = loopThroughFilesSync(params?.cssDir)
  for (const file of potentialCssFiles) {
    if (!isBinaryFile(file) && file?.endsWith('.css')) {
      cssFiles.push(file)
    }
  }

  // gather list of potential js files to edit
  const potentialJsFiles = loopThroughFilesSync(params?.jsDir)
  for (const file of potentialJsFiles) {
    if (!isBinaryFile(file) && file?.endsWith('.js')) {
      jsFiles.push(file)
    }
  }

  // process html files first to gather class, ID, and data-* mappings
  for (const file of htmlFiles) {
    const editedFile = processHtmlContent(fs.readFileSync(file, 'utf8'))
    if (editedFile) {
      editedFiles[file] = {
        type: 'html',
        contents: editedFile
      }
    }
  }

  // process CSS files using the gathered mappings
  for (const file of cssFiles) {
    const editedFile = processCssContent(fs.readFileSync(file, 'utf8'))
    if (editedFile) {
      editedFiles[file] = {
        type: 'css',
        contents: editedFile
      }
    }
  }

  // process js files using the gathered mappings
  for (const file of jsFiles) {
    const editedFile = processJsContent(fs.readFileSync(file, 'utf8'))
    if (editedFile) {
      editedFiles[file] = {
        type: 'js',
        contents: editedFile
      }
    }
  }

  return editedFiles
}

module.exports = minifyHtmlAttributes
