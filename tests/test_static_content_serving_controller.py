import pytest
import sys, os
from bottle import template, static_file
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from static import static_content_serving_controller

def test_style_files_serving():
    assert static_content_serving_controller.serve_style_files('style.css').status_code == 200

def test_image_files_serving():
    assert static_content_serving_controller.serve_image_files('img.css').status_code == 404

def test_video_serving():
    assert static_content_serving_controller.serve_videos('sampleVideo.mp4').status_code == 200

def test_script_serving():
    assert static_content_serving_controller.serve_scripts('uploader.js').status_code == 200