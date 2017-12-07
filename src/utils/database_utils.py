import yaml
from couchdb import Server

with open('configuration/config.yaml', 'r') as ymlfile:
    config = yaml.load(ymlfile)

couch = Server(config['couchdb']['server'])


def get_album_document(album_id):
    return _get_doc_database().get(album_id, include_docs=True)

def get_all_album_documents():
    documents = _get_doc_database().view('_all_docs', include_docs=True)
    return [{'album_name' : row.doc['album_name'], 'id' : row.doc.id} for row in documents]

def save_album_document(album_name):
    album_document = {
        'album_name' : album_name
    }
    return _get_doc_database().save(album_document)

def _get_doc_database():
    try:
        db = couch[config['couchdb']['database']]
    except:
        db = couch.create(config['couchdb']['database'])

    return db
