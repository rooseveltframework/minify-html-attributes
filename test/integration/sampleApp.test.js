const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { chromium } = require('playwright')

const sampleAppDir = path.join(__dirname, '..', '..', 'sampleApps', 'express')
const preprocessedViews = path.join(sampleAppDir, 'mvc', '.preprocessed_views')
const preprocessedStatics = path.join(sampleAppDir, '.preprocessed_statics')

// the sample app is built by minify-html-attributes and served by express, then driven in a real browser: this is what proves the renames actually hold together once the css cascade and the js are live.

let server
let browser
let baseUrl

function findFreePort () {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function startServer (port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: sampleAppDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''
    const failed = message => reject(new Error(`${message}\n${stderr}\nRun \`npm ci\` in sampleApps/express first.`))
    child.stdout.on('data', chunk => { if (chunk.toString().includes('server is running')) resolve(child) })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => failed(error.message))
    child.on('exit', code => { if (code !== null) failed(`the sample app exited with code ${code}`) })
    setTimeout(() => failed('the sample app did not start within 120 seconds'), 120000).unref()
  })
}

// killing the express process is not enough on windows, where the webpack and node children it spawned would keep the port held
function stopServer (child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}

// collects everything the page logs so the assertions can look for the markers the sample app prints when a rename came through intact
async function loadPage (route) {
  const page = await browser.newPage()
  const logs = []
  const errors = []
  page.on('console', message => logs.push(message.text()))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' })
  return { page, logs, errors }
}

before(async () => {
  const port = await findFreePort()
  baseUrl = `http://127.0.0.1:${port}`
  server = await startServer(port)
  // CI installs the bundled browser with `npx playwright install chromium`; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to point at one you already have
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
})

after(async () => {
  await browser?.close()
  stopServer(server)
})

describe('the minified sample app renders correctly', () => {
  test('the first paragraph is red, from an inline stylesheet', async () => {
    const { page } = await loadPage('/')
    const color = await page.evaluate(() => window.getComputedStyle(document.querySelectorAll('section p')[0]).color)
    assert.equal(color, 'rgb(255, 0, 0)')
    await page.close()
  })

  test('the second paragraph is purple, from an inline script', async () => {
    const { page } = await loadPage('/')
    const color = await page.evaluate(() => window.getComputedStyle(document.querySelectorAll('section p')[1]).color)
    assert.equal(color, 'rgb(255, 0, 255)')
    await page.close()
  })

  test('the third paragraph is green and underlined, from a stylesheet and a script', async () => {
    const { page } = await loadPage('/')
    const style = await page.evaluate(() => {
      const paragraph = document.querySelectorAll('section p')[2]
      const computed = window.getComputedStyle(paragraph)
      return { color: computed.color, textDecoration: computed.textDecoration }
    })
    assert.equal(style.color, 'rgb(0, 255, 0)')
    assert.ok(style.textDecoration.includes('underline'))
    await page.close()
  })

  test('no page raises a javascript error', async () => {
    for (const route of ['/', '/secondPage', '/pageWithForm']) {
      const { page, errors } = await loadPage(route)
      assert.deepEqual(errors, [], `${route} raised errors`)
      await page.close()
    }
  })
})

describe('every reference style survives the rename', () => {
  const homepageMarkers = [
    'id query selector',
    'class query selector',
    'data query selector',
    'template literal',
    'concat',
    'dataset 1',
    'dataset 2',
    'dynamic construction 1',
    'test exemption 1',
    'classList test',
    'className test',
    'insertAdjacentHTML test',
    'fragment link test',
    'untouched string test',
    'module path test'
  ]

  test('the homepage reports every marker', async () => {
    const { page, logs } = await loadPage('/')
    for (const marker of homepageMarkers) assert.ok(logs.includes(marker), `"${marker}" was not reported`)
    await page.close()
  })

  test('the form page reports its markers', async () => {
    const { page, logs } = await loadPage('/pageWithForm')
    assert.ok(logs.includes('document.forms test'))
    assert.ok(logs.includes('global var test'))
    await page.close()
  })
})

describe('the files on disk were really rewritten', () => {
  test('ids in the form template were renamed and the label followed', () => {
    const contents = fs.readFileSync(path.join(preprocessedViews, 'pageWithForm.html'), 'utf8')
    assert.ok(!contents.includes('id="your_name"'), 'the id should have been renamed')
    assert.ok(!contents.includes('for="your_name"'), 'the label should have followed it')
    assert.ok(contents.includes('name="your_name"'), 'the name attribute must not be renamed')
    const forValue = /for="([^"]+)"/.exec(contents)[1]
    assert.ok(contents.includes(`id="${forValue}"`), 'the label must point at the input')
  })

  test('the exempt name was left alone', () => {
    const contents = fs.readFileSync(path.join(preprocessedViews, 'layouts', 'main.html'), 'utf8')
    assert.ok(contents.includes('id="test-exemption"'))
  })

  test('data attribute names were renamed but their values were not', () => {
    const contents = fs.readFileSync(path.join(preprocessedViews, 'index.html'), 'utf8')
    assert.ok(!contents.includes('data-underline='), 'the data attribute name should have been renamed')
    assert.ok(contents.includes('="true"'), 'the data attribute value must be left alone')
  })

  test('the module path and the comments in the bundled js survived', () => {
    const contents = fs.readFileSync(path.join(preprocessedStatics, 'browser.js'), 'utf8')
    assert.ok(contents.includes("require('./makeThisRed.js')"), 'the module path must not be renamed')
    assert.ok(contents.includes('// string literals'), 'comments must survive')
    assert.ok(contents.includes("notASelector === 'makeThisRed'"), 'strings that are not selectors must survive')
  })

  test('template syntax in the layout survived', () => {
    const contents = fs.readFileSync(path.join(preprocessedViews, 'layouts', 'main.html'), 'utf8')
    assert.ok(contents.includes('{pageContent|s}'))
  })
})
