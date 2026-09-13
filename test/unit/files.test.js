const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { listFiles, readTextFile, hasExtension } = require('../../lib/files')

function withTempDir (build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mha-files-'))
  try {
    build(root)
    return root
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
}

describe('listing files', () => {
  test('finds files at every depth, in a stable order', () => {
    const root = withTempDir(dir => {
      fs.mkdirSync(path.join(dir, 'deep', 'deeper'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'b.txt'), 'b')
      fs.writeFileSync(path.join(dir, 'a.txt'), 'a')
      fs.writeFileSync(path.join(dir, 'deep', 'deeper', 'c.txt'), 'c')
    })
    const found = listFiles(root).map(file => path.relative(root, file).split(path.sep).join('/'))
    assert.deepEqual(found, ['a.txt', 'b.txt', 'deep/deeper/c.txt'])
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('skips hidden files and hidden directories', () => {
    const root = withTempDir(dir => {
      fs.mkdirSync(path.join(dir, '.hidden'))
      fs.writeFileSync(path.join(dir, '.dotfile'), 'x')
      fs.writeFileSync(path.join(dir, '.hidden', 'inside.txt'), 'x')
      fs.writeFileSync(path.join(dir, 'visible.txt'), 'x')
    })
    const found = listFiles(root).map(file => path.basename(file))
    assert.deepEqual(found, ['visible.txt'])
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('a missing directory contributes no files instead of throwing', () => {
    assert.deepEqual(listFiles(path.join(os.tmpdir(), 'mha-does-not-exist-' + Date.now())), [])
    assert.deepEqual(listFiles(undefined), [])
  })
})

describe('reading files as text', () => {
  test('reads utf-8, including characters outside ascii', () => {
    const root = withTempDir(dir => fs.writeFileSync(path.join(dir, 'x.html'), '<p>Ünïcøde — 🚀 More…</p>'))
    assert.equal(readTextFile(path.join(root, 'x.html')), '<p>Ünïcøde — 🚀 More…</p>')
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('rejects a file containing a null byte', () => {
    const root = withTempDir(dir => fs.writeFileSync(path.join(dir, 'x.bin'), Buffer.from([0x50, 0x00, 0x51])))
    assert.equal(readTextFile(path.join(root, 'x.bin')), null)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('rejects a file that is not valid utf-8', () => {
    const root = withTempDir(dir => fs.writeFileSync(path.join(dir, 'x.bin'), Buffer.from([0x50, 0xc3, 0x28, 0x51])))
    assert.equal(readTextFile(path.join(root, 'x.bin')), null)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('rejects a file above the size limit', () => {
    const root = withTempDir(dir => fs.writeFileSync(path.join(dir, 'big.css'), 'x'.repeat(2048)))
    assert.equal(readTextFile(path.join(root, 'big.css'), { maxBytes: 1024 }), null)
    assert.equal(readTextFile(path.join(root, 'big.css'), { maxBytes: 4096 })?.length, 2048)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('returns null for a file that does not exist', () => {
    assert.equal(readTextFile(path.join(os.tmpdir(), 'mha-nope-' + Date.now())), null)
  })
})

describe('extension matching', () => {
  test('is case insensitive', () => {
    assert.ok(hasExtension('/x/Y.CSS', ['.css']))
    assert.ok(!hasExtension('/x/y.scss', ['.css']))
    assert.ok(!hasExtension('/x/y', ['.css']))
  })
})
