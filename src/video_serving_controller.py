from bottle import Bottle, template, get, request
from utils import database_utils
from os import path

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

    return template('video.html', view_data)

@app.get('/albums')
def view_album_list():
    album_documents = database_utils.get_all_album_documents()
    view_data = {
        'albums' : map(lambda x: {'name' : x['album_name'], 'id' : x['id']}, album_documents)
    }

    return template('albums.html', view_data)

@app.get('/videos')
def view_videos_list():
    album_id = request.params['album_id']
    album_document = database_utils.get_album_document(album_id)

    view_data = {
        'album_name' : album_document['album_name'],
        'videos' : album_document['videos']
    }

    return template('videos.html', view_data)