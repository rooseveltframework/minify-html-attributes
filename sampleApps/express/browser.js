const moduleWasLoaded = require('./makeThisRed.js')

if (document.querySelector('#ptests')) {
  document.querySelector('.makeThisUnderlined').style.textDecoration = 'underline'

  // string literals
  console.log(document.querySelector('#makeThisPurple') ? 'id query selector' : '')
  console.log(document.querySelector('.makeThisUnderlined') ? 'class query selector' : '')
  console.log(document.querySelector('[data-underline-this]') ? 'data query selector' : '')

  // template literals
  const id = 'makeThisPurple'
  console.log(document.querySelector(`#${id}`) ? 'template literal' : '')

  // concatenation
  const className = 'makeThisUnderlined'
  console.log(document.querySelector('.' + className) ? 'concat' : '')

  // accessing data attributes with dataset
  console.log(document.querySelector('p[data-underline]').dataset.underline ? 'dataset 1' : '')
  console.log(document.querySelector('p[data-underline-this]').dataset.underlineThis ? 'dataset 2' : '')

  // dynamic construction
  const prefix = 'data-'
  const attribute = 'underline'
  console.log(document.querySelector(`[${prefix}${attribute}]`) ? 'dynamic construction 1' : '')

  // test exemption
  console.log(document.querySelector('#test-exemption') ? 'test exemption 1' : '')

  // classList
  const underlined = document.querySelector('.makeThisUnderlined')
  underlined.classList.add('addedByClassList')
  console.log(underlined.classList.contains('addedByClassList') ? 'classList test' : '')

  // className assignment, checked through the stylesheet
  const classNameTarget = document.querySelector('#classNameTarget')
  classNameTarget.className = 'appliedClassName'
  console.log(window.getComputedStyle(classNameTarget).fontWeight === '700' ? 'className test' : '')

  // markup inserted from js
  document.querySelector('#ptests').insertAdjacentHTML('beforeend', '<p id="insertedElement" class="makeThisRed">inserted</p>')
  console.log(document.querySelector('#insertedElement') ? 'insertAdjacentHTML test' : '')

  // an in-page fragment link must still resolve to its target
  const fragment = document.querySelector('#fragmentLink').getAttribute('href')
  console.log(document.querySelector(fragment) === document.querySelector('#ptests') ? 'fragment link test' : '')

  // strings that are not selectors must come through untouched
  const notASelector = 'makeThisRed'
  console.log(notASelector === 'makeThisRed' ? 'untouched string test' : '')

  // and so must the module path this file requires, or webpack could not build
  console.log(moduleWasLoaded() ? 'module path test' : '')
}

if (document.querySelector('form')) {
  // accessing form elements as properties of the document.forms object
  const form = document.forms.myform
  console.log(form.elements.your_name ? 'document.forms test' : '')

  // accessing elements with id attributes as global variables
  if (typeof your_name !== 'undefined') { // eslint-disable-line
    console.log(your_name ? 'global var test' : '') // eslint-disable-line
  }
}
