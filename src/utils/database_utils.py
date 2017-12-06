import yaml
from couchdb import Server

with open('configuration/config.yaml', 'r') as ymlfile:
    config = yaml.load(ymlfile)

couch = Server(config['couchdb']['server'])
db = couch[config['couchdb']['database']]

def get_album_document(album_id):
    return db.get(album_id, include_docs=True)

def get_all_album_documents():
    documents = db.view('_all_docs', include_docs=True)
    return [{'album_name' : row.doc['album_name'], 'id' : row.doc.id} for row in documents]

def save_album_document(album_name):
    album_document = {
        'album_name' : album_name
    }
    return db.save(album_document)