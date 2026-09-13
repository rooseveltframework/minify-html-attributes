// this module's path deliberately matches a class name used in the app: a minifier that rewrites arbitrary strings would rename it and break the build
module.exports = function moduleWasLoaded () {
  return true
}
