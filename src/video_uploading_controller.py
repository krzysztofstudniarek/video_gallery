from bottle import Bottle, template, get

app = Bottle()

@app.get('/')
def view_new_gallery_form():
    return template('index.html')


def 