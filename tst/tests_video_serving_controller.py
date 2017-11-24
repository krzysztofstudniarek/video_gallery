import pytest
import sys, os
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import video_serving_controller

def test_view_index():
    with boddle():
        assert video_serving_controller.view_index_page() == template('index.html')

def test_video_serivng():
    with boddle(method='get', params={'video_id':123123}):
        assert video_serving_controller.view_video_page() == template('video.html', {'video_file_path':'sampleVideo.mp4'})