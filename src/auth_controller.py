import hashlib
from bottle import Bottle, template, get, request
from utils import database_utils

app = Bottle()

@app.get('/register')
def serve_register_form():
    return template('auth_views/register_form.html')

@app.post('/register')
def register_user():
    username = request.forms.get('username')
    password = request.forms.get('password')
    password_conf = request.forms.get('confirmPassword')

    if username in database_utils.get_all_usernames():
        return template('auth_views/info.html', {'error': "User with name " + username + " already exists."})

    if password != password_conf :
        return template('auth_views/info.html', {'error': "Confirmation and password are not equal."})

    password_hash = _get_hash_of_password(password)
    database_utils.save_user_to_database(username, password_hash)
    return template('auth_views/info.html', {'success': "Your account was created correctly."})

def _get_hash_of_password(password):
    return hashlib.sha512(password).hexdigest()
