import yaml
import bottle
from beaker.middleware import SessionMiddleware

from src import qr_controller
from src import index_controller
from src import auth_controller
from src import video_management_controller
from src import album_management_controller

from static import static_content_serving_controller

def main():
    with open('configuration/config.yaml', 'r') as ymlfile:
        config = yaml.load(ymlfile)


    app = index_controller.app
    app.mount('manage_video', video_management_controller.app)
    app.mount('qr', qr_controller.app)
    app.mount('auth', auth_controller.app)
    app.mount('manage_album', album_management_controller.app)
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

