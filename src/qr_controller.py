import pyqrcode
import yaml
import random

from bottle import Bottle, template, request
from utils import filesystem_utils
from os import getcwd
from os.path import splitext

app = Bottle()
with open('configuration/config.yaml', 'r') as ymlfile:
    config = yaml.load(ymlfile)

colours = [[85,98,112], [78,205,196], [199,244,100], [255,107,107]]

@app.get('/generate')
def generate_qr_codes():
    album_id = request.params['album_id']
    videos_names = filesystem_utils.get_videos_names(album_id)
    print videos_names
    qr_images = map(lambda name: _prepare_qr_code(album_id, name), videos_names)
    return template('qr_views/qr.html', {'album_id' : album_id, 'qr_images' : qr_images})

def _prepare_qr_code(album_id, video_name):
    url = _get_show_video_url(album_id, video_name)
    path = getcwd() + '/static/qr_images/' + album_id + '/'
    filesystem_utils.initailize_directory(path)
    qr_image_name = splitext(video_name)[0]+'.jpg'
    _generate_qr_image(url, path+qr_image_name)
    return qr_image_name

def _generate_qr_image(url, qr_path):
    img = pyqrcode.create(url, error='Q')
    img.png(qr_path, scale=5, module_color=colours[random.randint(0, len(colours)-1)]) 

def _get_show_video_url(album_id, video_name):
    return 'http://'+str(config['general']['hostname'])+':'+str(config['general']['port'])+'/show/video?album_id='+album_id+'&video_name='+video_name