import pytest
import sys, os
from bottle import template, static_file
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from static import static_content_serving_controller

def test_static_files_serving():
    assert static_content_serving_controller.serve_staic_files('style.css').status_code == 200

def test_video_serving():
    assert static_content_serving_controller.serve_videos('sampleVideo.mp4').status_code == 200