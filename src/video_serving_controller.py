from bottle import Bottle, template, get, request

app = Bottle()

@app.get('/')
def view_index_page():
    return template('index.html')

@app.get('video/')
def view_video_page():
    viewData = {
        'videoId' : request.params['videoId']
    }
    return template('video.html', viewData)