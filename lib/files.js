const fs = require('node:fs')
const path = require('node:path')

// ignoreBOM keeps a leading byte order mark in the decoded text, so a file that had one still has one after it is rewritten
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const isHidden = name => name.startsWith('.')

// lists every non-hidden file under `directory`, recursively, following symbolic links to files and directories. a linked directory that leads back to one already being listed is not followed again.
function listFiles (directory) {
  if (!directory) return []
  const files = []
  const visited = new Set()

  function walk (current) {
    let realPath
    let entries
    try {
      realPath = fs.realpathSync(current)
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return // a missing directory simply contributes no files
    }
    if (visited.has(realPath)) return
    visited.add(realPath)

    for (const entry of entries) {
      if (isHidden(entry.name)) continue // skip hidden files and directories
      const entryPath = path.join(current, entry.name)
      let isFile = entry.isFile()
      let isDirectory = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        const target = fs.statSync(entryPath, { throwIfNoEntry: false }) // null when the link is broken
        isFile = !!target?.isFile()
        isDirectory = !!target?.isDirectory()
      }
      if (isFile) files.push(entryPath)
      else if (isDirectory) walk(entryPath)
    }
  }

  walk(directory)
  return files.sort() // stable order keeps output deterministic
}

// reads a file as utf-8 text, returning null when it is binary, too large, not valid utf-8, or unreadable. `onSkip` hears why, as one of 'unreadable', 'too large', 'binary', or 'not utf-8'. the old implementation treated any byte above 126 as binary, which quietly skipped every source file containing an accented character, a curly quote, or an emoji.
function readTextFile (filePath, { maxBytes = 16 * 1024 * 1024, onSkip = () => {} } = {}) {
  let buffer
  try {
    const stats = fs.statSync(filePath)
    if (stats.size > maxBytes) {
      onSkip('too large')
      return null
    }
    buffer = fs.readFileSync(filePath)
  } catch {
    onSkip('unreadable')
    return null
  }
  if (buffer.includes(0)) { // a null byte means binary
    onSkip('binary')
    return null
  }
  try {
    return decoder.decode(buffer)
  } catch {
    onSkip('not utf-8') // not source we can safely rewrite
    return null
  }
}

function hasExtension (filePath, extensions) {
  return extensions.includes(path.extname(filePath).toLowerCase())
}

module.exports = { listFiles, readTextFile, hasExtension }
