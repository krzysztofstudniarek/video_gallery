from bottle import Bottle, template, get, request
from os import getcwd
from plupload import plupload

app = Bottle()

@app.get('/new_album')
def view_new_album_form():
    return template('newAlbum.html')

@app.post('/new_album')
def create_new_album():
    return template('index.html')

@app.get('/upload')
def view_upload_video_form():
    return template('upload.html')

@app.post('/upload')
def upload_new_video(): 
    path = getcwd() + '/videos'
    return plupload.save(request.forms, request.files, path)