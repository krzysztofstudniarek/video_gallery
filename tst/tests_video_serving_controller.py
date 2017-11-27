import pytest
import mock
import sys, os
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import video_serving_controller

test_album_id = '1123213'
test_video_id = '123123'
test_video_file_path = 'sampleVideo.mp4'

def test_view_index():
    with boddle():
        assert video_serving_controller.view_index_page() == template('index.html')

@mock.patch('src.utils.database_utils.get_album_document')
def test_video_serivng(mocked_database_utils):
    
    mocked_database_utils.return_value = {
            'album_id' : test_album_id,
            'videos' : 
                {
                    test_video_id :'sampleVideo.mp4'
                }
        }

    with boddle(method='get', params={'album_id':test_album_id, 'video_id':test_video_id}):
        assert video_serving_controller.view_video_page() == template('video.html', {'video_file_path':test_video_file_path})
