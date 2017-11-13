from bottle import Bottle, route, static_file

app = Bottle()

#STATIC ROUTES
@app.route('/<filename>')
def serve_staic_files(filename):
    return static_file(filename, root='static/')