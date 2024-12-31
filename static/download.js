class DownloadManager {
    constructor(files, oneTimeDownload) {
        this.files = files;
        this.oneTimeDownload = oneTimeDownload;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Add click event listener to download all button
        const downloadAllBtn = document.getElementById('downloadAllBtn');
        if (downloadAllBtn) {
            downloadAllBtn.addEventListener('click', () => this.downloadAll());
        }

        // Add reload handler for one-time downloads
        if (this.oneTimeDownload) {
            document.querySelectorAll('.download-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    setTimeout(() => window.location.reload(), 2000);
                });
            });
        }
    }

    async downloadAll() {
        const downloadAllBtn = document.getElementById('downloadAllBtn');
        if (!downloadAllBtn) return;

        try {
            downloadAllBtn.disabled = true;
            downloadAllBtn.textContent = 'Downloading...';

            // Download files sequentially
            for (const file of this.files) {
                const link = document.createElement('a');
                link.href = encodeURI(file.download_url);
                link.download = file.original_name;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            if (this.oneTimeDownload) {
                setTimeout(() => window.location.reload(), 2000);
            }
        } catch (error) {
            console.error('Download all failed:', error);
        } finally {
            downloadAllBtn.disabled = false;
            downloadAllBtn.textContent = 'Download All Files';
        }
    }
}