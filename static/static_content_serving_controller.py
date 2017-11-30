from bottle import Bottle, route, static_file

app = Bottle()

@app.route('/styles/<filename>')
def serve_style_files(filename):
    return static_file(filename, root='static/styles')

@app.route('/images/<filename>')
def serve_image_files(filename):
    return static_file(filename, root='static/images')

@app.route('/videos/<album_id>/<filename>')
def serve_videos(album_id,filename):
    return static_file(filename, root='static/videos/'+album_id+'/')

@app.route('/scripts/<filename>')
def serve_scripts(filename):
    return static_file(filename, root='static/scripts/')