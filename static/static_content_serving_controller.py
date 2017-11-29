from bottle import Bottle, route, static_file

app = Bottle()

@app.route('/<filename>')
def serve_staic_files(filename):
    return static_file(filename, root='/')

@app.route('/videos/<filename>')
def serve_videos(filename):
    return static_file(filename, root='videos/')

@app.route('/scripts/<filename>')
def serve_scripts(filename):
    return static_file(filename, root='static/scripts/')