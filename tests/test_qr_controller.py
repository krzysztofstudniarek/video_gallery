import mock
import pytest
import sys, os
import shutil
import yaml
import base64

from os import makedirs, rmdir
from os.path import exists, dirname, abspath
from bottle import template, request, BottleException
from boddle import boddle 

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

with open('configuration/config.yaml', 'r') as ymlfile:
    config = yaml.load(ymlfile)

from src import qr_controller

qr_codes_list = ['vid1.jpg', 'vid2.jpg', 'vid3.jpg']
test_album_id = '123213'
test_album_name = 'ala ma kota'
test_album_documet = {
            'id' : test_album_id,
            'album_name' : test_album_name
        }

def _side_effect(value):
    value['user'] = 'stud'
    return value

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
def test_qr_code_generation_form(mocked_auth_utils, mocked_common_utils):
    with boddle(method='get', params={'album_id':test_album_id}):
        mocked_common_utils.side_effect = _side_effect
        view_data =  { 
            'album_id' : test_album_id,
            'palettes' : config['palettes'],
            'user' : 'stud'
        }
        assert qr_controller.show_qr_generation_form() == template('qr_views/qr_form.html',view_data)

def test_qr_code_generation_form_not_authorized():
    with boddle(method='get', params={'album_id':test_album_id}):
        request.environ['beaker.session'] = {}
        with pytest.raises(BottleException) as resp:
            qr_controller.show_qr_generation_form()

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
@mock.patch('src.utils.database_utils.get_album_document')
def test_qr_code_generationw(mocked_database_utils, mocked_auth_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_documet
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='post', params={'album_id':test_album_id, 'palettes' : 'plain_black'}):
        assert qr_controller.generate_qr_codes() == template('qr_views/qr.html', { 'album_id' : test_album_id, 'qr_images' : qr_codes_list, 'user' : 'stud'})
        assert exists('static/qr_images/'+test_album_id+'/vid1.jpg')
        assert exists('static/qr_images/'+test_album_id+'/vid2.jpg')
        assert exists('static/qr_images/'+test_album_id+'/vid3.jpg')

    shutil.rmtree('static/videos/' + test_album_id + '/')
    shutil.rmtree('static/qr_images/' + test_album_id + '/')

def test_qr_code_generation_not_authorized():
    with boddle(method='get', params={'album_id':test_album_id}):
        request.environ['beaker.session'] = {}
        with pytest.raises(BottleException) as resp:
            qr_controller.generate_qr_codes()
        assert not exists('static/qr_images/'+test_album_id+'/vid1.jpg')
        assert not exists('static/qr_images/'+test_album_id+'/vid2.jpg')
        assert not exists('static/qr_images/'+test_album_id+'/vid3.jpg')

def setup_module(module):
    if not exists('static/videos/'+test_album_id+'/'):
        makedirs('static/videos/'+test_album_id+'/')
    
    open('static/videos/'+test_album_id+'/vid1.mp4', 'a').close()
    open('static/videos/'+test_album_id+'/vid2.mp4', 'a').close()
    open('static/videos/'+test_album_id+'/vid3.mp4', 'a').close()
