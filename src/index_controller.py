from bottle import Bottle, template, get, request
from utils import common_utils

app = Bottle()

@app.get('/')
def serve_index_page():
    session = request.environ.get('beaker.session')
    view_data = {}
    return template('index.html', common_utils.attach_user(view_data))