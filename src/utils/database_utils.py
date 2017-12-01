from couchdb import Server

couch = Server('http://0.0.0.0:5984/')
db = couch['albums']

def get_album_document(album_id):
    return db.get(album_id, include_docs=True)

def get_all_album_documents():
    documents = db.view('_all_docs', include_docs=True)
    return [{'album_name' : row.doc['album_name'], 'id' : row.doc.id, 'videos': row.doc['videos']} for row in documents]

def save_album_document(album_name):
    album_document = {
        'album_name' : album_name,
        'videos' : []
    }
    return db.save(album_document)