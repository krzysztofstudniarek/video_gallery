import shutil
from bottle import Bottle, template, get, request, redirect
from utils import database_utils, auth_utils, common_utils, filesystem_utils

app = Bottle()

@app.get('/albums')
def view_album_list():
    auth_utils.authorize()
    owner = common_utils.get_user_form_session()
    album_documents = database_utils.get_all_album_documents(owner)
    view_data = {
        'albums' : album_documents,
    }

    return template('manage_views/albums.html', common_utils.attach_user(view_data))

@app.get('/new_album')
def view_new_album_form():
    auth_utils.authorize()
    return template('manage_views/newAlbum.html', common_utils.attach_user({}))

@app.post('/new_album')
def create_new_album():
    auth_utils.authorize()
    album_name = _extract_album_name_from_request(request)
    owner = common_utils.get_user_form_session()
    album_id, album_doc_rev = database_utils.save_album_document(album_name, owner)
    filesystem_utils.initailize_videos_directory(album_id)

    view_data = {
        'album_name' : album_name,
        'album_id' : album_id,
        'videos' : filesystem_utils.get_videos_names(album_id),
    }

    return template('manage_views/album_details.html', common_utils.attach_user(view_data))

def _extract_album_name_from_request(request):
    return request.forms.get('album_name')

def _extract_videos_from_request(request):
    return request.forms.getlist('videos[]')

@app.get('/details')
def view_videos_list():
    auth_utils.authorize()

    album_id = request.params['album_id']
    album_document = database_utils.get_album_document(album_id)

    view_data = {
        'album_name' : album_document['album_name'],
        'album_id' : album_id,
        'videos' : filesystem_utils.get_videos_names(album_id)
    }

    return template('manage_views/album_details.html', common_utils.attach_user(view_data))

@app.post('/delete')
def delete_album():
    auth_utils.authorize()
    album_id = request.forms.get('album_id')
    database_utils.delete_album_document(album_id)
    shutil.rmtree('static/videos/'+album_id+'/')

    return redirect('/manage_album/albums')