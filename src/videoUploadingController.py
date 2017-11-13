from bottle import Bottle, template, get

app = Bottle()

@app.get('/')
def viewNewGalleryForm():
    return template('index.html')
