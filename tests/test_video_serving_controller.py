import pytest
import base64
import mock
import sys
import shutil
from os import makedirs, rmdir
from os.path import exists, dirname, abspath
from bottle import template, BottleException, request
from boddle import boddle
from couchdb.client import Document

sys.path.insert(0,
    dirname(dirname(abspath(__file__))))

from src import video_serving_controller

test_album_id = '1123213'
test_album_id_2 = '11232dasda'
test_album_name = 'ala ma kota'
test_album_name_2 = 'ala ma kota 2'
test_video_file_path = 'sampleVideo.mp4'

test_album_documet = {
            'id' : test_album_id,
            'album_name' : test_album_name
        }

test_album_documet_2 = {
            'id' : test_album_id_2,
            'album_name' : test_album_name_2
        }

test_album_list = [test_album_documet, test_album_documet_2]

def test_view_index():
    with boddle():
        assert video_serving_controller.view_index_page() == template('index.html')

def _side_effect(value):
    value['user'] = 'stud'
    return value

@mock.patch('src.utils.database_utils.get_album_document')
def test_video_serivng(mocked_database_utils):
    mocked_database_utils.return_value = test_album_documet
    with boddle(method='get', params={'album_id':test_album_id, 'video_name':test_video_file_path}):
        assert video_serving_controller.view_video_page() == template('show_views/video.html', {'video_file_path':test_album_id + '/'+ test_video_file_path})

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
@mock.patch('src.utils.database_utils.get_all_album_documents')
def test_get_list_of_albums(mocked_database_utils, mocked_auth_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_list
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get'):
        assert video_serving_controller.view_album_list() == template('show_views/albums.html', {
            'albums' : [test_album_documet, test_album_documet_2],
            'user' : 'stud'
        })

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.database_utils.get_all_album_documents')
def test_get_list_of_albums_not_authorized(mocked_database_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_list
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get'):
        request.environ['beaker.session'] = {}
        with pytest.raises(BottleException) as resp:
            video_serving_controller.view_album_list()

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
@mock.patch('src.utils.database_utils.get_album_document')
def test_get_list_of_videos(mocked_database_utils, mocked_auth_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_documet
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get', params={'album_id':test_album_id}):
        assert video_serving_controller.view_videos_list() == template('show_views/album_details.html', {'album_id': test_album_id, 'album_name' : test_album_name, 'videos' : [], 'user' : 'stud'})

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.database_utils.get_all_album_documents')
def test_get_list_of_videos_not_authorized(mocked_database_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_list
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get'):
        request.environ['beaker.session'] = {}
        with pytest.raises(BottleException) as resp:
            video_serving_controller.view_videos_list()

def setup_module(module):
    if not exists('static/videos/'+test_album_id+'/'):
        makedirs('static/videos/'+test_album_id+'/')

def teardown_module(module):
    shutil.rmtree('static/videos/'+test_album_id+'/')