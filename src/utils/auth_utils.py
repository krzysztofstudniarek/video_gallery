import database_utils
import hashlib
from bottle import auth_basic

def authenticate(username, password):
    try:
        user = database_utils.get_user(username)
        if user['password'] == hashlib.sha512(password).hexdigest():
            return True
        return False
    except Exception as error:
        print('Invalid User Error: ' + repr(error))
        return False