from bottle import Bottle, template, get

app = Bottle()

@app.get('/')
def view_new_album_form():
    return template('newAlbum.html')