from bottle import request

def attach_user(view_data):
    session = request.environ.get('beaker.session')
    if session is not None and 'current_user' in session :
        view_data['user'] = session['current_user']
    
    return view_data