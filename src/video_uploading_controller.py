from bottle import Bottle, template, get, request
from os import getcwd, listdir
from os.path import isfile, join
from plupload import plupload
from utils import database_utils

app = Bottle()

@app.get('/new_album')
def view_new_album_form():
    view_data = {
        'videos' : _get_video_file_names_from_directory()
    }
    return template('newAlbum.html',view_data)

@app.post('/new_album')
def create_new_album():
    videos = _extract_videos_from_request(request)
    print database_utils.save_album_document(videos)
    return template('index.html')

@app.get('/upload')
def view_upload_video_form():
    return template('upload.html')

@app.post('/upload')
def upload_new_video(): 
    path = getcwd() + '/videos'
    return plupload.save(request.forms, request.files, path)

def _get_video_file_names_from_directory():
    return [f for f in listdir(getcwd() + '/videos') if isfile(join(getcwd() + '/videos', f)) and f != '.gitkeep']

def _extract_videos_from_request(request):
    return request.forms.getlist('videos[]')