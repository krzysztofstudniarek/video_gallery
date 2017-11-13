import bottle

from src import videoServingController
from src import videoUploadingController

from static import staticServingController

def main():
    bottle.mount('show', videoServingController.app)
    bottle.mount('upload', videoUploadingController.app)
    bottle.mount('static', staticServingController.app)
    bottle.run(host='0.0.0.0', port=8080, debug=True)

if __name__ == "__main__":
    main()

