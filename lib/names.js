const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

// produces a, b, ... Z, aa, ab, ... in order; skips anything already reserved
function * generateMinifiedNames (reserved) {
  for (let length = 1; ; length++) {
    const max = Math.pow(NAME_CHARS.length, length)
    for (let index = 0; index < max; index++) {
      let name = ''
      let remainder = index
      for (let position = 0; position < length; position++) {
        name = NAME_CHARS[remainder % NAME_CHARS.length] + name
        remainder = Math.floor(remainder / NAME_CHARS.length)
      }
      if (!reserved.has(name)) yield name
    }
  }
}

// tracks every name seen in a namespace, then hands out minified replacements. names are assigned in descending order of how often they appear so the most frequently used names get the shortest replacements; ties break on the order the names were first seen so that output is deterministic.
class NameRegistry {
  constructor ({ exemptNames = [], disabledNamespaces = [] } = {}) {
    this.exemptNames = new Set(exemptNames)
    this.disabledNamespaces = new Set(disabledNamespaces)
    this.namespaces = new Map() // namespace -> Map(name -> { count, order })
    this.assignments = new Map() // namespace -> Map(name -> minified)
    this.assigned = false
    this.seenCount = 0
  }

  // records one usage of a name so it can be counted and later assigned
  observe (namespace, name) {
    if (this.assigned) throw new Error('cannot observe names after assignment')
    if (!this.isRenameable(namespace, name)) return
    let names = this.namespaces.get(namespace)
    if (!names) {
      names = new Map()
      this.namespaces.set(namespace, names)
    }
    const existing = names.get(name)
    if (existing) existing.count++
    else names.set(name, { count: 1, order: this.seenCount++ })
  }

  isRenameable (namespace, name) {
    if (this.disabledNamespaces.has(namespace)) return false
    if (this.exemptNames.has(name)) return false
    return typeof name === 'string' && name.length > 0
  }

  // freezes the observed names and allocates a minified name for each
  assign () {
    if (this.assigned) return
    for (const [namespace, names] of this.namespaces) {
      // exempt names keep their original spelling, so a generated name must never collide with one of them
      const generator = generateMinifiedNames(this.exemptNames)
      const sorted = [...names.entries()].sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)
      const assignments = new Map()
      for (const [name] of sorted) assignments.set(name, generator.next().value)
      this.assignments.set(namespace, assignments)
    }
    this.assigned = true
  }

  // returns the minified name, or null when the name is not being renamed
  get (namespace, name) {
    if (!this.assigned) throw new Error('cannot read names before assignment')
    return this.assignments.get(namespace)?.get(name) ?? null
  }

  // a plain-object view of every mapping, for debugging and tests
  toJSON () {
    const result = {}
    for (const [namespace, assignments] of this.assignments) result[namespace] = Object.fromEntries(assignments)
    return result
  }
}

module.exports = { NameRegistry, generateMinifiedNames, NAME_CHARS }
