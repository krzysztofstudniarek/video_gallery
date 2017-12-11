import database_utils
import hashlib
import python_jwt as jwt
import jwcrypto.jwk as jwk
import datetime
from bottle import redirect, request

key = jwk.JWK.generate(kty='RSA', size=2048)

def authenticate(username, password):
    try:
        user = database_utils.get_user(username)
        return user['password'] == hashlib.sha512(password).hexdigest()
    except Exception as error:
        print('Invalid User Error: ' + repr(error))
        return False

def get_autorization_token(username, password):
    payload = { 'user': username, 'password': hashlib.sha512(password).hexdigest() }
    return jwt.generate_jwt(payload, key, 'PS256', datetime.timedelta(minutes=5))

def authorize():
    session = request.environ.get('beaker.session')
    if 'auth_token' not in session:
        redirect('/auth/login')
    if not _validate_token(session['auth_token']): 
        redirect('/auth/login')

def _validate_token(token):
    header, claims = jwt.verify_jwt(token, key, ['PS256'])
    user = database_utils.get_user(claims['user'])
    return user['password'] == claims['password']