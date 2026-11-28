const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

// html attribute names are case-insensitive, so `data-a` and `data-A` are the same attribute, and `dataset.A` looks for `data--a`. data-* names therefore only ever get lowercase replacements.
const LOWERCASE_NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz'

// the alphabet each namespace draws its replacements from; anything not listed uses NAME_CHARS
const NAMESPACE_ALPHABETS = { data: LOWERCASE_NAME_CHARS }

// produces a, b, ... Z, aa, ab, ... in order; skips anything already reserved
function * generateMinifiedNames (reserved, alphabet = NAME_CHARS) {
  for (let length = 1; ; length++) {
    const max = Math.pow(alphabet.length, length)
    for (let index = 0; index < max; index++) {
      let name = ''
      let remainder = index
      for (let position = 0; position < length; position++) {
        name = alphabet[remainder % alphabet.length] + name
        remainder = Math.floor(remainder / alphabet.length)
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
    this.excluded = new Map() // namespace -> Set(name) of names found to be unsafe to rename after they were observed
    this.reserved = new Map() // namespace -> Set(name) of spellings a replacement must never take
    this.assigned = false
    this.seenCount = 0
  }

  // records one usage of a name so it can be counted and later assigned. with `onlyIfKnown`, a usage only counts toward a name something else has already brought into existence
  observe (namespace, name, { onlyIfKnown = false } = {}) {
    if (this.assigned) throw new Error('cannot observe names after assignment')
    if (!this.isRenameable(namespace, name)) return
    if (onlyIfKnown && !this.namespaces.get(namespace)?.has(name)) return
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

  // every name observed so far in a namespace
  observed (namespace) {
    return [...(this.namespaces.get(namespace)?.keys() ?? [])]
  }

  // keeps one observed name at its original spelling in one namespace, which also stops any other name from being renamed to it
  exclude (namespace, name) {
    if (this.assigned) throw new Error('cannot exclude names after assignment')
    if (!this.excluded.has(namespace)) this.excluded.set(namespace, new Set())
    this.excluded.get(namespace).add(name)
  }

  // stops a replacement in one namespace from ever taking one of these spellings, without affecting whether the name itself is renamed
  reserve (namespace, names) {
    if (this.assigned) throw new Error('cannot reserve names after assignment')
    if (!this.reserved.has(namespace)) this.reserved.set(namespace, new Set())
    for (const name of names) this.reserved.get(namespace).add(name)
  }

  // freezes the observed names and allocates a minified name for each
  assign () {
    if (this.assigned) return
    for (const [namespace, names] of this.namespaces) {
      const excluded = this.excluded.get(namespace) ?? new Set()
      // names that keep their original spelling must never be handed out as somebody else's replacement
      const reserved = new Set([...this.exemptNames, ...excluded, ...(this.reserved.get(namespace) ?? [])])
      const generator = generateMinifiedNames(reserved, NAMESPACE_ALPHABETS[namespace])
      const sorted = [...names.entries()].filter(([name]) => !excluded.has(name)).sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)
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

module.exports = { NameRegistry, generateMinifiedNames, NAME_CHARS, LOWERCASE_NAME_CHARS }
