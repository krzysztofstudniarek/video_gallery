from couchdb import Server

couch = Server('http://0.0.0.0:5984/')
db = couch['albums']

def get_album_document(album_id):
    return db.get(album_id, include_docs=True)

def get_all_album_documents():
    return db.view('_all_docs', include_docs=True)