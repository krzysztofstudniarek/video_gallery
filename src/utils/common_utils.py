from bottle import request

def attach_user(view_data):
    user = get_user_form_session()
    if user != 'unknown' :
        view_data['user'] = user
    return view_data

def get_user_form_session():
    session = request.environ.get('beaker.session')
    if session is not None and 'current_user' in session :
        return session['current_user']
    return 'unknown' 
    