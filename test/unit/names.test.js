const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { NameRegistry, generateMinifiedNames, NAME_CHARS } = require('../../lib/names')

describe('name generator', () => {
  test('produces single characters before moving on to pairs', () => {
    const generator = generateMinifiedNames(new Set())
    const produced = []
    for (let index = 0; index < NAME_CHARS.length + 3; index++) produced.push(generator.next().value)
    assert.equal(produced[0], 'a')
    assert.equal(produced[25], 'z')
    assert.equal(produced[26], 'A')
    assert.equal(produced[51], 'Z')
    assert.equal(produced[52], 'aa')
    assert.equal(produced[53], 'ab')
  })

  test('never produces the same name twice', () => {
    const generator = generateMinifiedNames(new Set())
    const seen = new Set()
    for (let index = 0; index < 5000; index++) {
      const name = generator.next().value
      assert.ok(!seen.has(name), `${name} was produced twice`)
      seen.add(name)
    }
  })

  test('skips reserved names', () => {
    const generator = generateMinifiedNames(new Set(['a', 'b', 'aa']))
    assert.equal(generator.next().value, 'c')
    const rest = []
    for (let index = 0; index < 60; index++) rest.push(generator.next().value)
    assert.ok(!rest.includes('aa'))
  })
})

describe('name registry', () => {
  test('gives the shortest names to the most frequently used', () => {
    const registry = new NameRegistry()
    registry.observe('class', 'rare')
    for (let index = 0; index < 5; index++) registry.observe('class', 'common')
    for (let index = 0; index < 3; index++) registry.observe('class', 'middling')
    registry.assign()
    assert.equal(registry.get('class', 'common'), 'a')
    assert.equal(registry.get('class', 'middling'), 'b')
    assert.equal(registry.get('class', 'rare'), 'c')
  })

  test('breaks ties on first appearance so output is deterministic', () => {
    const build = () => {
      const registry = new NameRegistry()
      registry.observe('class', 'first')
      registry.observe('class', 'second')
      registry.assign()
      return registry.toJSON()
    }
    assert.deepEqual(build(), build())
    assert.deepEqual(build().class, { first: 'a', second: 'b' })
  })

  test('keeps namespaces independent', () => {
    const registry = new NameRegistry()
    registry.observe('class', 'thing')
    registry.observe('id', 'other')
    registry.assign()
    assert.equal(registry.get('class', 'thing'), 'a')
    assert.equal(registry.get('id', 'other'), 'a')
    assert.equal(registry.get('id', 'thing'), null)
  })

  test('leaves exempt names alone and never reuses them', () => {
    const registry = new NameRegistry({ exemptNames: ['a', 'keepMe'] })
    registry.observe('class', 'keepMe')
    registry.observe('class', 'renameMe')
    registry.assign()
    assert.equal(registry.get('class', 'keepMe'), null)
    assert.equal(registry.get('class', 'renameMe'), 'b', 'the exempt name "a" must not be handed out')
  })

  test('a disabled namespace renames nothing', () => {
    const registry = new NameRegistry({ disabledNamespaces: ['class'] })
    registry.observe('class', 'thing')
    registry.observe('id', 'thing')
    registry.assign()
    assert.equal(registry.get('class', 'thing'), null)
    assert.equal(registry.get('id', 'thing'), 'a')
  })

  test('refuses to be read before assignment or written after it', () => {
    const registry = new NameRegistry()
    assert.throws(() => registry.get('class', 'x'), /before assignment/)
    registry.assign()
    assert.throws(() => registry.observe('class', 'x'), /after assignment/)
  })
})
