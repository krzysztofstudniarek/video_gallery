import bottle
import yaml

from src import video_serving_controller
from src import video_uploading_controller
from src import qr_controller

from static import static_content_serving_controller

def main():
    with open('configuration/config.yaml', 'r') as ymlfile:
        config = yaml.load(ymlfile)

    bottle.mount('show', video_serving_controller.app)
    bottle.mount('add', video_uploading_controller.app)
    bottle.mount('qr', qr_controller.app)
    bottle.mount('static/', static_content_serving_controller.app)
    bottle.run(host=config['general']['hostname'], port=config['general']['port'], debug=True)

if __name__ == "__main__":
    main()

