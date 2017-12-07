from bottle import Bottle, template, get, request
from utils import database_utils, filesystem_utils

app = Bottle()

@app.get('/')
def view_index_page():
    return template('index.html')

@app.get('/video')
def view_video_page():
    album_id = request.params['album_id']
    video_name = request.params['video_name']
    
    view_data = {
        'video_file_path' : album_id+'/'+video_name
    }

    return template('show_views/video.html', view_data)

@app.get('/albums')
def view_album_list():
    album_documents = database_utils.get_all_album_documents()
    view_data = {
        'albums' : album_documents
    }

    return template('show_views/albums.html', view_data)

@app.get('/details')
def view_videos_list():
    album_id = request.params['album_id']
    album_document = database_utils.get_album_document(album_id)

    view_data = {
        'album_name' : album_document['album_name'],
        'album_id' : album_id,
        'videos' : filesystem_utils.get_videos_names(album_id)
    }

    return template('show_views/album_details.html', view_data)