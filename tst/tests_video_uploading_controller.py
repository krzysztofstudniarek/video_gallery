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
        assert video_uploading_controller.view_new_album_form() == template('newAlbum.html')