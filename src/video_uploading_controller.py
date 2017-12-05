from bottle import Bottle, template, get, request
from os import getcwd, listdir, makedirs
from os.path import isfile, join, exists
from plupload import plupload
from utils import database_utils
from utils import filesystem_utils

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
    album_id = request.params['album_id']
    view_data = {
        'album_id' : album_id
    }
    return template('upload.html', view_data)

@app.post('/upload')
def upload_new_video(): 
    path = getcwd() + '/static/videos/' + request.forms.get('album_id') + '/'
    filesystem_utils.initailize_directory(path)
    return plupload.save(request.forms, request.files, path)

def _extract_videos_from_request(request):
    return request.forms.getlist('videos[]')

def _extract_album_name_from_request(request):
    return request.forms.get('album_name')