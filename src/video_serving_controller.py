from bottle import Bottle, template, get, request
from utils import database_utils

app = Bottle()

@app.get('/')
def view_index_page():
    return template('index.html')

@app.get('/video')
def view_video_page():
    album_id = request.params['album_id']
    video_id = request.params['video_id']
    album_document = database_utils.get_album_document(album_id)
    
    viewData = {
        'video_file_path' : album_document['videos'][str(video_id)]
    }

    return template('video.html', viewData)

@app.get('/albums')
def view_album_list():
    album_documents = database_utils.get_all_album_documents()

    viewData = {
        'albums' : map(lambda x: x['album_name'], album_documents)
    }

    return template('albums.html', viewData)
