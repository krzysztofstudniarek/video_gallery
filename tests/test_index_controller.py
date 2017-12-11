import pytest
import sys, os
import base64
from mock import mock
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import index_controller

@mock.patch('src.utils.common_utils.attach_user')
def test_index_page_while_logged_in_serving(mocked_common_utils):
    mocked_common_utils.return_value = {'user' : 'stud'}
    with boddle(method='get'):
        assert index_controller.serve_index_page() == template('index.html', {'user' : 'stud'})

@mock.patch('src.utils.common_utils.attach_user')
def test_index_page_while_not_logged_in_serving(mocked_common_utils):
    mocked_common_utils.return_value = {}
    with boddle(method='get'):
        assert index_controller.serve_index_page() == template('index.html')