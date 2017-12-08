import pytest
import mock
import sys, os

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