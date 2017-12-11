import pytest
import mock
import sys, os
import python_jwt as jwt
import jwcrypto.jwk as jwk
from bottle import request
import bottle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.utils import auth_utils

test_user = {
        'username' : 'test',
        'password' : '31d339d16a488f29dc145c01e9ce3b2f74a333a889efa3cd2dafd81892ad1dddee4045bd8823d3b25317ebbbf131ccf052ccc0d915b934d765ce0198d7dbddb9'
    }

@mock.patch('src.utils.database_utils.get_user')
def test_user_with_correct_password_is_authenticated(mocked_database_utils):
    mocked_database_utils.return_value = test_user
    assert auth_utils.authenticate('test', 'stud') == True

@mock.patch('src.utils.database_utils.get_user')
def test_user_with_incorect_password_is_not_authenticated(mocked_database_utils):
    mocked_database_utils.return_value = test_user
    assert auth_utils.authenticate('test', 'wrong_password') == False

@mock.patch('src.utils.database_utils.get_user')
def test_wrong_user_is_not_authenticated(mocked_database_utils):
    mocked_database_utils.side_effect = Exception(format('no user with username test'))
    assert auth_utils.authenticate('wrong_user', 'stud') == False

@mock.patch('src.utils.database_utils.get_user')
def test_authorize_with_correct_token(mocked_database_utils):
    mocked_database_utils.return_value = test_user
    token = auth_utils.get_autorization_token('test', 'stud')
    request.environ = {'beaker.session' : {'auth_token' : token, 'current_user' : 'test'}}
    assert auth_utils.authorize()

@mock.patch('src.utils.database_utils.get_user')
def test_authorize_without_token(mocked_database_utils):
    mocked_database_utils.return_value = test_user
    request.environ = {'beaker.session' : {'current_user' : 'test'}}
    _assert_redirect('/auth/login', 'http://127.0.0.1/auth/login')

@mock.patch('src.utils.database_utils.get_user')
def test_authorize_with_wrong_token(mocked_database_utils):
    mocked_database_utils.return_value = test_user
    wrong_token = auth_utils.get_autorization_token('test', 'wrong_test_passowrd')
    request.environ = {'beaker.session' : {'auth_token' : wrong_token, 'current_user' : 'test'}}
    _assert_redirect('/auth/login', 'http://127.0.0.1/auth/login')

def test_correct_token_is_generated():
    cmp_token = auth_utils.get_autorization_token('test', 'stud')
    header, values = jwt.verify_jwt(cmp_token, auth_utils.key, ['PS256'])
    assert values['user'] == test_user['username']
    assert values['password'] == test_user['password']

def _assert_redirect(target, result, query=None, status=303, **args):
        env = {'SERVER_PROTOCOL': 'HTTP/1.1'}
        for key in list(args):
            if key.startswith('wsgi'):
                args[key.replace('_', '.', 1)] = args[key]
                del args[key]
        env.update(args)
        request.bind(env)
        bottle.response.bind()
        try:
            bottle.redirect(target, **(query or {}))
        except bottle.HTTPResponse as E:
            assert (status == E.status_code)
            assert (E.headers)
            assert (result == E.headers['Location'])