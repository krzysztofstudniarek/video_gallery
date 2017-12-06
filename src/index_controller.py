from bottle import Bottle, template, get, request

app = Bottle()

@app.get('/')
def serve_index_page():
    return template('index.html')