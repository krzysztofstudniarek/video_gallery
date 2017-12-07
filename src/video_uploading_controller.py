from bottle import Bottle, template, get, request
from os import getcwd, listdir, makedirs
from os.path import isfile, join, exists
from plupload import plupload
from utils import database_utils
from utils import filesystem_utils

app = Bottle()

@app.get('/new_album')
def view_new_album_form():
    return template('add_views/newAlbum.html')

@app.post('/new_album')
def create_new_album():
    album_name = _extract_album_name_from_request(request)
    album_id, album_doc_rev = database_utils.save_album_document(album_name)
    _initailize_videos_directory(album_id)

    view_data = {
        'album_name' : album_name,
        'album_id' : album_id,
        'videos' : filesystem_utils.get_videos_names(album_id)
    }

    return template('show_views/album_details.html', view_data)

@app.get('/upload')
def view_upload_video_form():
    album_id = request.params['album_id']
    view_data = {
        'album_id' : album_id
    }
    return template('add_views/upload.html', view_data)

@app.post('/upload')
def upload_new_video(): 
    path = _get_videos_directory(request.forms.get('album_id'))
    return plupload.save(request.forms, request.files, path)

def _initailize_videos_directory(album_id):
    path = _get_videos_directory(album_id)
    filesystem_utils.initailize_directory(path)

def _get_videos_directory(album_id):
    return getcwd() + '/static/videos/' + album_id + '/'

def _extract_videos_from_request(request):
    return request.forms.getlist('videos[]')

def _extract_album_name_from_request(request):
    return request.forms.get('album_name')