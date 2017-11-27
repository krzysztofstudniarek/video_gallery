from couchdb import Server

couch = Server('http://0.0.0.0:5984/')
db = couch['albums']

def get_album_document(album_id):
    return db.get(album_id, include_docs=True)