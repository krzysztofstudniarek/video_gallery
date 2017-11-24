import pytest
import sys, os
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from static import staic_content_serving_controller

def testIndex():
    with boddle():
        assert videoServingController.viewIndexPage() == template('index.html')

def testVideoServingSite():
    with boddle():
        assert videoServingController.view_video_serve_page()