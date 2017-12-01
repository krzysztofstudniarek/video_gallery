import pytest
import mock
import sys, os
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import video_uploading_controller

def test_new_album_form_page():
    with boddle():
        view_data = {
            'videos' : ['SampleVideo.mp4']
        }
        assert video_uploading_controller.view_new_album_form() == template('newAlbum.html', view_data)

def test_video_upload_view():
    with boddle(method='get', params={'album_id':'123213'}):
        assert video_uploading_controller.view_upload_video_form() == template('upload.html', {'album_id' : '123213'})


@mock.patch('src.utils.database_utils.save_album_document')
def test_album_creation(mocked_database_utils):
    mocked_database_utils.return_value = 'asd123131', 'sdas12312'
    with boddle(method='post', params={'album_name':'test_album_name'}):
        assert video_uploading_controller.create_new_album() == template('index.html')
        mocked_database_utils.assert_called_once()
