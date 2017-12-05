from bottle import Bottle, template

app = Bottle()

@app.get('/generate')
def generate_qr_codes():
    return template('qr.html', {'qr_images' : []})