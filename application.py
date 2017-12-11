import yaml
import bottle
from beaker.middleware import SessionMiddleware

from src import video_serving_controller
from src import video_uploading_controller
from src import qr_controller
from src import index_controller
from src import auth_controller

from static import static_content_serving_controller

def main():
    with open('configuration/config.yaml', 'r') as ymlfile:
        config = yaml.load(ymlfile)


    app = index_controller.app
    app.mount('show', video_serving_controller.app)
    app.mount('add', video_uploading_controller.app)
    app.mount('qr', qr_controller.app)
    app.mount('auth', auth_controller.app)
    app.mount('static/', static_content_serving_controller.app)

    session_opts = {
        'session.type': 'memory',
        'session.cookie_expires': 300,
        'session.auto': True
    }
    app = SessionMiddleware(app, session_opts)

    bottle.run(
        app=app,
        host=config['general']['host'],
        port=config['general']['port'],
        debug=True,
        reloader=True)

if __name__ == "__main__":
    main()

