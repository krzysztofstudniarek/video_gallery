import pytest
import sys, os
import mock

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.utils import database_utils

test_username_1 = 'test_user'
test_password_1 = 'test_password'
test_user_doc_1 = {'username' : test_username_1, 'password' : test_password_1}

test_username_2 = 'test_user'
test_password_2 = 'test_password'
test_user_doc_2 = {'username' : test_username_2, 'password' : test_password_2}

test_album_name = 'test_album'
test_album_id = '12345678'
test_album_document = {
    'id' : test_album_id,
    'album_name' : test_album_name
}

class DocStub(dict) : 
    def __getattr__(self, name):
        return self[name]

class DocumentStub :
    def __init__(self, documentStub):
        self.doc = documentStub

test_users_list = [DocumentStub(DocStub(test_user_doc_1)), DocumentStub(DocStub(test_user_doc_2))]
test_albums_list = [DocumentStub(DocStub(test_album_document))]

def _users_db_side_effect(value, include_docs = False):
    return test_users_list

def _albums_db_side_effect(value, include_docs = False):
    return test_albums_list

@mock.patch('src.utils.database_utils.users_db.view')
def test_get_user(mocked_couch_db):
    mocked_couch_db.side_effect = _users_db_side_effect
    assert database_utils.get_user(test_username_1)['password'] == test_password_1

@mock.patch('src.utils.database_utils.users_db.view')
def test_get_all_usernames(mocked_couch_db):
    mocked_couch_db.side_effect = _users_db_side_effect
    assert database_utils.get_all_usernames() == [test_username_1, test_username_2]

@mock.patch('src.utils.database_utils.album_db.view')
def test_get_all_album_documents(mocked_couch_db):
    mocked_couch_db.side_effect = _albums_db_side_effect
    documents = database_utils.get_all_album_documents() 
    assert len(documents) == 1
    assert documents[0]['album_name'] == test_album_name
    assert documents[0]['id'] == test_album_id