import pytest
import sys, os
from mock import mock
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import auth_controller

test_username = 'test_username'
test_password = 'test_password'

def test_registration_form_serving():
    with boddle(method='get'):
        assert auth_controller.serve_register_form() == template('auth_views/register_form.html')

@mock.patch('src.utils.database_utils.save_user_to_database')
@mock.patch('src.utils.database_utils.get_all_usernames')
def test_corect_user_registration(mock_get_all_usernames, mock_save_user_to_database):
    mock_get_all_usernames.return_value = []
    mock_save_user_to_database.return_value = "", ""
    test_params = {
        'username' : test_username,
        'password' : test_password,
        'confirmPassword' : test_password
    }
    with boddle(method='post', params=test_params):
        assert auth_controller.register_user() == template('auth_views/info.html', {'success': "Your account was created correctly."})

@mock.patch('src.utils.database_utils.save_user_to_database')
@mock.patch('src.utils.database_utils.get_all_usernames')
def test_wrong_confirmation_then_no_registration(mock_get_all_usernames, mock_save_user_to_database):
    mock_get_all_usernames.return_value = []
    mock_save_user_to_database.return_value = "", ""
    test_params = {
        'username' : test_username,
        'password' : test_password,
        'confirmPassword' : ''
    }
    with boddle(method='post', params=test_params):
        assert auth_controller.register_user() == template('auth_views/info.html', {'error': "Confirmation and password are not equal."})

@mock.patch('src.utils.database_utils.save_user_to_database')
@mock.patch('src.utils.database_utils.get_all_usernames')
def test_already_existing_username_then_no_registration(mock_get_all_usernames, mock_save_user_to_database):
    mock_get_all_usernames.return_value = [test_username]
    mock_save_user_to_database.return_value = "", ""
    test_params = {
        'username' : test_username,
        'password' : test_password,
        'confirmPassword' : test_password
    }
    with boddle(method='post', params=test_params):
        assert auth_controller.register_user() == template('auth_views/info.html', {'error': "User with name " + test_username + " already exists."})