import pytest
import mock
import sys, os
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import video_uploading_controller

test_ablum_id = '123213'
test_album_name = 'test_album_name'
test_album_doc_rev = 'sdas12312'

def test_new_album_form_page():
    with boddle():
        view_data = {
            'videos' : ['SampleVideo.mp4']
        }
        assert video_uploading_controller.view_new_album_form() == template('add_views/newAlbum.html', view_data)

def test_video_upload_view():
    with boddle(method='get', params={'album_id':test_ablum_id}):
        assert video_uploading_controller.view_upload_video_form() == template('add_views/upload.html', {'album_id' : test_ablum_id})


@mock.patch('src.utils.database_utils.save_album_document')
def test_album_creation(mocked_database_utils):
    mocked_database_utils.return_value = test_ablum_id, test_album_doc_rev
    with boddle(method='post', params={'album_name':test_album_name}):
        assert video_uploading_controller.create_new_album() == template('index.html')
        mocked_database_utils.assert_called_once()
