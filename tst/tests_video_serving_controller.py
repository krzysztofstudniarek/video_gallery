import pytest
import mock
import sys, os
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import video_serving_controller

test_album_id = '1123213'
test_album_id_2 = '11232dasda'
test_video_id = '123123'
test_video_id_2 = '1dsadasf2'
test_album_name = 'ala ma kota'
test_album_name_2 = 'ala ma kota 2'
test_video_file_path = 'sampleVideo.mp4'

test_album_list = [
        {
            '_id' : test_album_id,
            'album_name' : test_album_name,
            'videos' : {
                test_video_id : test_video_file_path
            }
        },
        {
            'album_id' : test_album_id_2,
            'album_name' : test_album_name_2,
            'videos' : {
                test_video_id : test_video_file_path
            }
        }
    ]

def test_view_index():
    with boddle():
        assert video_serving_controller.view_index_page() == template('index.html')

@mock.patch('src.utils.database_utils.get_album_document')
def test_video_serivng(mocked_database_utils):
    mocked_database_utils.return_value = {
            '_id' : test_album_id,
            'album_name' : test_album_name,
            'videos' : 
                {
                    test_video_id : test_video_file_path
                }
        }

    with boddle(method='get', params={'album_id':test_album_id, 'video_id':test_video_id}):
        assert video_serving_controller.view_video_page() == template('video.html', {'video_file_path':test_video_file_path})


@mock.patch('src.utils.database_utils.get_all_album_documents')
def test_get_list_of_albums(mocked_database_utils):
    mocked_database_utils.return_value = test_album_list

    with boddle(method='get'):
        assert video_serving_controller.view_album_list() == template('albums.html', {'albums' : [test_album_name, test_album_name_2]})

@mock.patch('src.utils.database_utils.get_album_document')
def test_get_list_of_videos(mocked_database_utils):
    mocked_database_utils.return_value = {
        '_id' : test_album_id,
        'album_name' : test_album_name,
        'videos' : 
            {
                test_video_id : test_video_file_path,
                test_video_id_2 : test_video_file_path
            }
    }

    with boddle(method='get', params={'album_id':test_album_id}):
        assert video_serving_controller.view_videos_list() == template('videos.html', {'album_name' : test_album_name, 'videos' : { test_video_id : test_video_file_path, test_video_id_2 : test_video_file_path }})