module.exports = function (app) {
  app.get('/', (req, res) => {
    res.render('index', {})
  })

  app.get('/secondPage', (req, res) => {
    res.render('secondPage', { variable: 'variable with contents: "hi there!"' })
  })

  app.get('/pageWithForm', (req, res) => {
    res.render('pageWithForm', {})
  })

  app.post('/pageWithForm', (req, res) => {
    res.render('pageWithForm', {})
  })
}
