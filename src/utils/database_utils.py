import yaml
from couchdb import Server

with open('configuration/config.yaml', 'r') as ymlfile:
    config = yaml.load(ymlfile)

couch = Server(config['couchdb']['server'])

def _get_doc_database(database_name):
    try:
        db = couch[database_name]
    except:
        db = couch.create(database_name)

    return db

users_db = _get_doc_database(config['couchdb']['auth_database'])
album_db = _get_doc_database(config['couchdb']['database'])

def get_album_document(album_id):
    return album_db.get(album_id, include_docs=True)

def get_all_album_documents(owner):
    documents = album_db.view('_all_docs', include_docs=True)
    return [{'album_name' : row.doc['album_name'], 'id' : row.doc.id} for row in documents if (row.doc['owner'] == owner)]

def save_album_document(album_name):
    album_document = {
        'album_name' : album_name,
        'owner' : owner
    }
    return album_db.save(album_document)

def get_user(username):
    docs =  users_db.view('_all_docs', include_docs=True)
    users = [ _get_credentials_from_doc(document) for document in docs if (document.doc['username'] == username)]
    if len(users) == 0 :
        raise Exception('no user with username' + username)
    return users[0]

def get_all_usernames():
    docs = users_db.view('_all_docs', include_docs=True)
    return [ document.doc['username'] for document in docs ]

def save_user_to_database(username, password):
    user_document = {
        'username' : username,
        'password' : password
    }
    return users_db.save(user_document)

def _get_credentials_from_doc(document):
    return {
        'username' : document.doc['username'],
        'password' : document.doc['password']
    }


