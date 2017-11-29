var uploader = new plupload.Uploader({
browse_button: 'browse', // this can be an id of a DOM element or the DOM element itself
container: document.getElementById('container'), 
url: 'upload'
});

uploader.init();

uploader.bind('FilesAdded', function(up, files) {
    var html = '';
    plupload.each(files, function(file) {
        html += '<li id="' + file.id + '">' + file.name + ' (' + plupload.formatSize(file.size) + ') <b></b></li>';
    });
    document.getElementById('filelist').innerHTML += html;
});

uploader.bind('UploadProgress', function(up, file) {
    document.getElementById(file.id).getElementsByTagName('b')[0].innerHTML = '<span>' + file.percent + "%</span>";
});

document.getElementById('start-upload').onclick = function() {
    uploader.start();
};