from bottle import Bottle, template, get, request
from os import getcwd
from plupload import plupload

app = Bottle()

@app.get('/')
def view_new_album_form():
    return template('newAlbum.html')

@app.post('/upload')
def upload_new_image(): 
    path = getcwd() + '/videos'
    return plupload.save(request.forms, request.files, path)