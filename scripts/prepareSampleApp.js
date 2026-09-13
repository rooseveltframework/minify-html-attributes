// The integration tests build and serve the express sample app, which has its own dependency tree. Installing it by hand is the step people (and CI) used to forget, so the test scripts run this first.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const sampleAppDir = path.join(__dirname, '..', 'sampleApps', 'express')
const stamp = path.join(sampleAppDir, 'node_modules', '.package-lock.json')
const lockFile = path.join(sampleAppDir, 'package-lock.json')

function isUpToDate () {
  if (!fs.existsSync(stamp)) return false
  return fs.statSync(stamp).mtimeMs >= fs.statSync(lockFile).mtimeMs
}

if (isUpToDate()) {
  console.log('sample app dependencies are already installed')
} else {
  console.log('installing sample app dependencies in sampleApps/express')
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], { cwd: sampleAppDir, stdio: 'inherit' })
}
