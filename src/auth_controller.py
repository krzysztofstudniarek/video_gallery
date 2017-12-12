import hashlib
import httplib
from datetime import date, timedelta
from bottle import Bottle, template, get, request, redirect, response
from utils import database_utils, auth_utils

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

@app.get('/login')
def serve_login_form():
    return template('auth_views/login_form.html')

@app.post('/login')
def login_user():
    username = request.forms.get('username')
    password = request.forms.get('password')
    if auth_utils.authenticate(username,password):
        session = request.environ['beaker.session']
        session['auth_token'] = auth_utils.get_autorization_token(username, password)
        session['current_user'] = username
        session.save()
        redirect('/')
    else :
        return template('auth_views/login_form.html', {'error': "Your username or password are incorect."})

@app.get('/logout')
def logout():
    session = request.environ['beaker.session']
    session.delete()
    redirect('/')

def _get_hash_of_password(password):
    return hashlib.sha512(password).hexdigest()
