// applies a list of {start, end, text} replacements to a string. edits are absolute offsets into source; overlapping edits are dropped
function applyEdits (source, edits) {
  if (!edits.length) return source
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end)
  let result = ''
  let cursor = 0
  for (const edit of sorted) {
    if (edit.start < cursor) continue // overlaps a previous edit; drop it
    result += source.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return result + source.slice(cursor)
}

module.exports = { applyEdits }
