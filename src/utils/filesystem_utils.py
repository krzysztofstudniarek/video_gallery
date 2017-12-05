from os import listdir, makedirs
from os.path import exists, join, isfile

def initailize_directory(path):
    if not exists(path):
        makedirs(path)

def get_videos_names(album_id):
    path = 'static/videos/'+album_id+'/'
    return [f for f in listdir(path) if isfile(join(path, f))]