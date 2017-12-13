from bottle import Bottle, template, get, request, redirect
from os import getcwd, listdir, makedirs
from os.path import isfile, join, exists
from plupload import plupload
from utils import database_utils
from utils import filesystem_utils
from utils import auth_utils
from utils import common_utils

app = Bottle()

@app.get('/upload')
def view_upload_video_form():
    auth_utils.authorize()
    album_id = request.params['album_id']
    view_data = {
        'album_id' : album_id,
    }
    return template('add_views/upload.html', common_utils.attach_user(view_data))

@app.post('/upload')
def upload_new_video():
    path = filesystem_utils.get_videos_directory(request.forms.get('album_id'))
    return plupload.save(request.forms, request.files, path)

@app.get('/video')
def view_video_page():
    album_id = request.params['album_id']
    video_name = request.params['video_name']
    
    view_data = {
        'video_file_path' : album_id+'/'+video_name,
    }
    return template('show_views/video.html', common_utils.attach_user(view_data))
