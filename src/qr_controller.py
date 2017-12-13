import pyqrcode
import yaml
import random

from bottle import Bottle, template, request, hook
from utils import filesystem_utils, auth_utils, common_utils
from os import getcwd
from os.path import splitext

app = Bottle()
with open('configuration/config.yaml', 'r') as ymlfile:
    config = yaml.load(ymlfile)

@app.get('/generate')
def show_qr_generation_form():
    auth_utils.authorize()
    view_data = {
        'album_id' : request.params['album_id'],
        'palettes' : _get_available_palettes(),
    }
    
    return template('qr_views/qr_form.html', common_utils.attach_user(view_data))

@app.post('/generate')
def generate_qr_codes():
    auth_utils.authorize()
    palette = _get_palette(request.forms.get('palettes'))
    album_id = request.forms.get('album_id')
    videos_names = filesystem_utils.get_videos_names(album_id)
    qr_images = map(lambda name: _prepare_qr_code(album_id, name, palette), videos_names)

    view_data = {
        'album_id' : album_id,
         'qr_images' : qr_images
         }
         
    return template('qr_views/qr.html', common_utils.attach_user(view_data))

def _prepare_qr_code(album_id, video_name, colour_palette):
    url = _get_show_video_url(album_id, video_name)
    path = getcwd() + '/static/qr_images/' + album_id + '/'
    filesystem_utils.initailize_directory(path)
    qr_image_name = splitext(video_name)[0]+'.jpg'
    _generate_qr_image(url, path+qr_image_name, colour_palette)
    return qr_image_name

def _generate_qr_image(url, qr_path, colour_palette):
    img = pyqrcode.create(url, error='Q')
    img.png(qr_path, scale=5, module_color=colour_palette[random.randint(0, len(colour_palette)-1)]) 

def _get_palette(palette_name):
    return config['palettes'][palette_name]['colors']

def _get_available_palettes():
    return config['palettes']

def _get_show_video_url(album_id, video_name):
    return 'http://'+str(config['general']['hostname'])+':'+str(config['general']['port'])+'/manage_video/video?album_id='+album_id+'&video_name='+video_name