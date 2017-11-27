import bottle

from src import video_serving_controller

from static import static_content_serving_controller

def main():
    bottle.mount('show', video_serving_controller.app)
    bottle.mount('static/', static_content_serving_controller.app)
    bottle.run(host='0.0.0.0', port=8080, debug=True)

if __name__ == "__main__":
    main()

