import mock
import sys, os
from os import makedirs, rmdir
from os.path import exists, dirname, abspath
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import qr_controller

qr_codes_list = ['vid1.jpg', 'vid2.jpg', 'vid3.jpg']
test_album_id = '123213'
test_album_name = 'ala ma kota'
test_album_documet = {
            'id' : test_album_id,
            'album_name' : test_album_name
        }

@mock.patch('src.utils.database_utils.get_album_document')
def test_qr_code_generationw(mocked_database_utils):
    mocked_database_utils.return_value = test_album_documet
    with boddle(method='get', params={'album_id':test_album_id}):
        assert qr_controller.generate_qr_codes() == template('qr.html', {'qr_images' : qr_codes_list})
        assert exists('static/qr_images/'+test_album_id+'/vid1.jpg')
        assert exists('static/qr_images/'+test_album_id+'/vid2.jpg')
        assert exists('static/qr_images/'+test_album_id+'/vid3.jpg')

def setup_module(module):
    if not exists('static/videos/'+test_album_id+'/'):
        makedirs('static/videos/'+test_album_id+'/')
    
    open('static/videos/'+test_album_id+'/vid1.mp4', 'a').close()
    open('static/videos/'+test_album_id+'/vid2.mp4', 'a').close()
    open('static/videos/'+test_album_id+'/vid3.mp4', 'a').close()

def teardown_module(module):
    rmdir('static/videos/' + test_album_id + '/')
    rmdir('static/qr_images/' + test_album_id + '/')