import pytest
import sys, os
from bottle import template
from boddle import boddle

sys.path.insert(0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import index_controller

def test_index_page_serving():
    with boddle(method='get'):
        assert index_controller.serve_index_page() == template('index.html')