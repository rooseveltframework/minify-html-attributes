/* eslint-env mocha */
const assert = require('assert')
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const sampleAppDir = path.join(__dirname, '..', 'sampleApps', 'express')

before(async function () {
  await new Promise((resolve, reject) => {
    const serverProcess = exec('npm start', { cwd: sampleAppDir })
    serverProcess.stdout.on('data', (data) => {
      if (data.toString().includes('express sample app server is running')) resolve()
    })
    serverProcess.stderr.on('data', (data) => {
      console.error(data.toString())
      console.error('Make sure to `npm ci` in the sampleApp/express directory first!')
    })
    serverProcess.on('error', (error) => reject(error))
    this.serverProcess = serverProcess
  })
})

after(async function () {
  if (this.serverProcess) this.serverProcess.kill()
})

describe('minify-html-attributes tests', function () {
  it('should replace IDs', async function () {
    const filePath = path.join(sampleAppDir, 'mvc', '.preprocessed_views', 'pageWithForm.html')
    const fileContent = fs.readFileSync(filePath, 'utf8')
    assert(!fileContent.includes('for="your_name"'), 'Expected markup not found')
  })

  it('should have first <p> tag on main page be red', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto('http://localhost:3000/')
    const firstPColor = await page.evaluate(() => {
      const firstP = document.querySelector('p:first-of-type')
      return window.getComputedStyle(firstP).color
    })
    assert.strictEqual(firstPColor, 'rgb(255, 0, 0)')
    await browser.close()
  })

  it('should have second <p> tag on main page be purple', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto('http://localhost:3000/')
    const secondPColor = await page.evaluate(() => {
      const secondP = document.querySelector('p:nth-of-type(2)')
      return window.getComputedStyle(secondP).color
    })
    assert.strictEqual(secondPColor, 'rgb(255, 0, 255)')
    await browser.close()
  })

  it('should have first <p> tag on main page be green and underlined', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto('http://localhost:3000/')
    const firstPStyle = await page.evaluate(() => {
      const thirdP = document.querySelector('p:nth-of-type(3)')
      const color = window.getComputedStyle(thirdP).color
      const textDecoration = window.getComputedStyle(thirdP).textDecoration
      return { color, textDecoration }
    })
    assert.strictEqual(firstPStyle.color, 'rgb(0, 255, 0)')
    assert(firstPStyle.textDecoration.includes('underline'))
    await browser.close()
  })

  it('should successfully update an ID query selector in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('id query selector')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update a class query selector in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('class query selector')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update a data attr query selector in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('data query selector')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update template literal in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('template literal')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update variable concatenation in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('concat')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update element.dataset in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('dataset 1')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update element.dataset with camelCase in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('dataset 2')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update dynamic variable construction in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('dynamic construction 1')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should skip renaming anything on the exemptions list', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('test exemption 1')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update document.forms in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('document.forms test')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/pageWithForm')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })

  it('should successfully update global variables derived from input IDs in the JS', async function () {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    let consoleLogFound = false
    page.on('console', msg => {
      if (msg.text().includes('global var test')) consoleLogFound = true
    })
    await page.goto('http://localhost:3000/pageWithForm')
    assert(consoleLogFound, 'Expected console log not found')
    await browser.close()
  })
})
