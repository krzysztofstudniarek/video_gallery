import pytest
import mock
import sys
import shutil
import os
from os import makedirs, rmdir
from os.path import exists, dirname, abspath
from bottle import template, BottleException, request
from boddle import boddle

sys.path.insert(0,
    dirname(dirname(abspath(__file__))))

from src import album_management_controller

test_album_id = '1123213'
test_album_doc_rev = 'sdas12312'
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

test_videos_view_data = {
            'album_name' : test_album_name,
            'album_id' : test_album_id,
            'videos' : [],
            'user' : 'stud'
}

test_album_list = [test_album_documet, test_album_documet_2]

def _side_effect(value):
    value['user'] = 'stud'
    return value

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
@mock.patch('src.utils.database_utils.get_all_album_documents')
def test_get_list_of_albums(mocked_database_utils, mocked_auth_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_list
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get'):
        assert album_management_controller.view_album_list() == template('manage_views/albums.html', {
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
            album_management_controller.view_album_list()

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
@mock.patch('src.utils.database_utils.save_album_document')
def test_album_creation(mocked_database_utils,mocked_auth_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_id, test_album_doc_rev
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='post', params={'album_name':test_album_name}):
        assert album_management_controller.create_new_album() == template('manage_views/album_details.html', test_videos_view_data)
        assert _was_folder_created(test_album_id)
        mocked_database_utils.assert_called_once()
        
@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.database_utils.save_album_document')
def test_album_creation_not_authorized(mocked_database_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_id, test_album_doc_rev
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get'):
        request.environ['beaker.session'] = {}
        with pytest.raises(BottleException) as resp:
             album_management_controller.create_new_album()

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
def test_new_album_form_page(mocked_auth_utils, mocked_common_utils):
    mocked_common_utils.side_effect = _side_effect
    with boddle():
        view_data = {
            'videos' : ['SampleVideo.mp4'],
            'user' : 'stud'
        }
        assert album_management_controller.view_new_album_form() == template('manage_views/newAlbum.html', view_data)

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
@mock.patch('src.utils.database_utils.get_album_document')
def test_get_list_of_videos(mocked_database_utils, mocked_auth_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_documet
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get', params={'album_id':test_album_id}):
        assert album_management_controller.view_videos_list() == template('manage_views/album_details.html', {'album_id': test_album_id, 'album_name' : test_album_name, 'videos' : [], 'user' : 'stud'})


@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.database_utils.get_all_album_documents')
def test_get_list_of_videos_not_authorized(mocked_database_utils, mocked_common_utils):
    mocked_database_utils.return_value = test_album_list
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get'):
        request.environ['beaker.session'] = {}
        with pytest.raises(BottleException) as resp:
            album_management_controller.view_videos_list()

def _was_folder_created(album_id):
    return os.path.exists('static/videos/'+album_id+'/')

def teardown_module(module):
    shutil.rmtree('static/videos/'+test_album_id+'/')