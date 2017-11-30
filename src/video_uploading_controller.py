from bottle import Bottle, template, get, request
from os import getcwd, listdir
from os.path import isfile, join
from plupload import plupload
from utils import database_utils

app = Bottle()

@app.get('/new_album')
def view_new_album_form():
    return template('newAlbum.html')

@app.post('/new_album')
def create_new_album():
    album_name = _extract_album_name_from_request(request)
    print database_utils.save_album_document(album_name)
    return template('index.html')

@app.get('/upload')
def view_upload_video_form():
    return template('upload.html')

@app.post('/upload')
def upload_new_video(): 
    print request.forms.get('album_id')
    path = getcwd() + '/static/videos/' + request.forms.get('album_id') + '/'
    return plupload.save(request.forms, request.files, path)

def _extract_videos_from_request(request):
    return request.forms.getlist('videos[]')

def _extract_album_name_from_request(request):
    return request.forms.get('album_name')