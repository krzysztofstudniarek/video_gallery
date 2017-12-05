import qrcode
from bottle import Bottle, template, request
from utils import database_utils
from os import listdir, getcwd, makedirs
from os.path import isfile, join, splitext, exists

app = Bottle()

@app.get('/generate')
def generate_qr_codes():
    album_id = request.params['album_id']
    videos_names = _get_videos_names(album_id)
    print videos_names
    qr_images = map(lambda name: _prepare_qr_code(album_id, name), videos_names)
    return template('qr.html', {'album_id' : album_id, 'qr_images' : qr_images})

def _get_videos_names(album_id):
    path = 'static/videos/'+album_id+'/'
    return [f for f in listdir(path) if isfile(join(path, f))]

def _prepare_qr_code(album_id, video_name):
    url = _get_url_to_video(album_id, video_name)
    path = getcwd() + '/static/qr_images/' + album_id + '/'
    _initailize_directory(path)
    qr_image_name = splitext(video_name)[0]+'.jpg'
    _generate_qr_image(url, path+qr_image_name)
    return qr_image_name

def _generate_qr_image(url, qr_path):
    img = qrcode.make(url)
    img.save(qr_path)
    img.close()

def _initailize_directory(path):
    if not exists(path):
        makedirs(path)

def _get_url_to_video(album_id, video_name):
    return 'http://localhost:8080/show/video?album_id='+album_id+'&video_name='+video_name