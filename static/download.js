class DownloadManager {
    constructor(files, oneTimeDownload) {
        this.files = files;
        this.oneTimeDownload = oneTimeDownload;
        this.initializeEventListeners();
        console.log('DownloadManager initialized with', files.length, 'files');
    }

    initializeEvent 