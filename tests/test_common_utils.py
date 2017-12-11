import pytest
import sys, os
from bottle import request
from boddle import boddle
from mock import MagicMock

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.utils import common_utils

test_view_data = {
    'key_1' : 1232,
    'key_2' : 'value'
}

test_view_data_with_user = {
    'key_1' : 1232,
    'key_2' : 'value',
    'user'  : 'test_username'
}

def test_attach_user_with_empty_user():
    assert common_utils.attach_user(test_view_data) == test_view_data

def test_attach_user():
    request.environ = {'beaker.session' : {'current_user' : 'test_username'}}
    assert common_utils.attach_user(test_view_data) == test_view_data_with_user
