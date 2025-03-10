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
