const fs = require('node:fs')
const path = require('node:path')

const decoder = new TextDecoder('utf-8', { fatal: true })

// lists every non-hidden file under `directory`, recursively
function listFiles (directory) {
  if (!directory) return []
  let entries
  try {
    entries = fs.readdirSync(directory, { recursive: true, withFileTypes: true })
  } catch {
    return [] // a missing directory simply contributes no files
  }
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name.startsWith('.')) continue // skip hidden files
    const filePath = path.join(entry.parentPath ?? entry.path ?? directory, entry.name)
    if (path.relative(directory, filePath).split(path.sep).some(segment => segment.startsWith('.'))) continue // skip hidden directories
    files.push(filePath)
  }
  return files.sort() // stable order keeps output deterministic
}

// reads a file as utf-8 text, returning null when it is binary or too large. the old implementation treated any byte above 126 as binary, which quietly skipped every source file containing an accented character, a curly quote, or an emoji.
function readTextFile (filePath, { maxBytes = 16 * 1024 * 1024 } = {}) {
  let buffer
  try {
    const stats = fs.statSync(filePath)
    if (stats.size > maxBytes) return null
    buffer = fs.readFileSync(filePath)
  } catch {
    return null
  }
  if (buffer.includes(0)) return null // a null byte means binary
  try {
    return decoder.decode(buffer)
  } catch {
    return null // not valid utf-8, so not source we can safely rewrite
  }
}

function hasExtension (filePath, extensions) {
  return extensions.includes(path.extname(filePath).toLowerCase())
}

module.exports = { listFiles, readTextFile, hasExtension }
