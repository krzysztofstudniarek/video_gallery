from bottle import Bottle, template, get, request

app = Bottle()

@app.get('/')
def serve_index_page():
    print 'auth', request.auth
    print 'remote_addr', request.remote_addr
    return template('index.html')