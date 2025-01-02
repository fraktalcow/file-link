// Add these constants at the top of the file, matching the backend limits
const MAX_FILE_SIZE = 500 * 1024 * 1024;  // 500MB
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024;  // 1GB

// Define the DownloadManager class in the global scope
window.DownloadManager = class DownloadManager {
    constructor(files, oneTimeDownload, groupId) {
        console.log('DownloadManager constructor called with:', {
            filesCount: files.length,
            oneTimeDownload,
            groupId
        });
        
        if (!groupId) {
            throw new Error('Group ID is required');
        }
        
        this.files = files;
        this.oneTimeDownload = oneTimeDownload;
        this.groupId = groupId;
        this.initializeDownloadAll();
    }

    initializeDownloadAll() {
        console.log('Initializing download button...');
        this.downloadAllBtn = document.getElementById('downloadAllBtn');
        
        if (!this.downloadAllBtn) {
            console.error('Download button not found in the DOM');
            return;
        }
        
        console.log('Adding click listener to download button');
        this.downloadAllBtn.addEventListener('click', async (e) => {
            console.log('Download button clicked');
            await this.handleDownloadAll(e);
        });
    }

    async handleDownloadAll(e) {
        console.log('Starting download process...');
        e.preventDefault();

        if (this.oneTimeDownload) {
            console.log('One-time download detected, showing confirmation');
            if (!confirm("Warning: This is a one-time download link. Once you download these files, they will no longer be accessible. Do you want to continue?")) {
                console.log('User cancelled one-time download');
                return;
            }
        }

        try {
            // Show loading state
            this.downloadAllBtn.disabled = true;
            this.downloadAllBtn.innerHTML = `
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Preparing Download...
            `;

            // Create a new array of promises for downloading each file
            const downloadPromises = this.files.map(async (file) => {
                const response = await fetch(file.download_url);
                if (!response.ok) throw new Error(`Failed to download ${file.original_name}`);
                return {
                    name: file.original_name,
                    data: await response.blob()
                };
            });

            // Wait for all downloads to complete
            const downloadedFiles = await Promise.all(downloadPromises);

            // Create a zip file using JSZip
            const zip = new JSZip();
            downloadedFiles.forEach(file => {
                zip.file(file.name, file.data);
            });

            // Generate the zip file
            const zipBlob = await zip.generateAsync({type: 'blob'});

            // Create a download link for the zip
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const zipFilename = `shared_files_${timestamp}.zip`;
            const url = window.URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = zipFilename;
            document.body.appendChild(a);
            
            console.log('Triggering download...');
            a.click();
            
            // Cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            console.log('Download triggered and cleanup completed');

            // If it's a one-time download, show a message and disable the button
            if (this.oneTimeDownload) {
                console.log('Handling one-time download completion');
                setTimeout(() => {
                    this.downloadAllBtn.innerHTML = 'Files Downloaded';
                    this.downloadAllBtn.disabled = true;
                }, 2000);
            } else {
                console.log('Resetting download button');
                setTimeout(() => {
                    this.downloadAllBtn.disabled = false;
                    this.downloadAllBtn.innerHTML = 'Download All Files';
                }, 2000);
            }
        } catch (error) {
            console.error('Download error:', error);
            alert(`Failed to download files: ${error.message}`);
            this.downloadAllBtn.disabled = false;
            this.downloadAllBtn.innerHTML = 'Download All Files';
        }
    }
}; 