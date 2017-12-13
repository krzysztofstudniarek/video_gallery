import pytest
import mock
import shutil
import sys, os
from bottle import template, BottleException, request
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import video_management_controller

test_album_id = '123213'
test_album_name = 'test_album_name'
test_album_doc_rev = 'sdas12312'

test_album_id_2 = '11232dasda'
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

def _side_effect(value):
    value['user'] = 'stud'
    return value

@mock.patch('src.utils.common_utils.attach_user')
@mock.patch('src.utils.auth_utils.authorize')
def test_video_upload_view(mocked_auth_utils, mocked_common_utils):
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get', params={'album_id':test_album_id}):
        assert video_management_controller.view_upload_video_form() == template('add_views/upload.html', {'album_id' : test_album_id, 'user' : 'stud'})

@mock.patch('src.utils.common_utils.attach_user')
def test_video_upload_view_not_authorized(mocked_common_utils):
    mocked_common_utils.side_effect = _side_effect
    with boddle(method='get'):
        request.environ['beaker.session'] = {}
        with pytest.raises(BottleException) as resp:
             video_management_controller.view_upload_video_form()

@mock.patch('src.utils.database_utils.get_album_document')
def test_video_serivng(mocked_database_utils):
    mocked_database_utils.return_value = test_album_documet
    with boddle(method='get', params={'album_id':test_album_id, 'video_name':test_video_file_path}):
        assert video_management_controller.view_video_page() == template('show_views/video.html', {'video_file_path':test_album_id + '/'+ test_video_file_path})