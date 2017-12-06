import pytest
import mock
import shutil
import sys, os
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import video_uploading_controller

test_album_id = '123213'
test_album_name = 'test_album_name'
test_album_doc_rev = 'sdas12312'

test_videos_view_data = {
            'album_name' : test_album_name,
            'album_id' : test_album_id,
            'videos' : []
        }

def test_new_album_form_page():
    with boddle():
        view_data = {
            'videos' : ['SampleVideo.mp4']
        }
        assert video_uploading_controller.view_new_album_form() == template('add_views/newAlbum.html', view_data)

def test_video_upload_view():
    with boddle(method='get', params={'album_id':test_album_id}):
        assert video_uploading_controller.view_upload_video_form() == template('add_views/upload.html', {'album_id' : test_album_id})


@mock.patch('src.utils.database_utils.save_album_document')
def test_album_creation(mocked_database_utils):
    mocked_database_utils.return_value = test_album_id, test_album_doc_rev
    with boddle(method='post', params={'album_name':test_album_name}):
        assert video_uploading_controller.create_new_album() == template('show_views/videos.html', test_videos_view_data)
        assert _was_folder_created(test_album_id)
        mocked_database_utils.assert_called_once()

def _was_folder_created(album_id):
    return os.path.exists('static/videos/'+album_id+'/')

def teardown_module(module):
    shutil.rmtree('static/videos/'+test_album_id+'/')