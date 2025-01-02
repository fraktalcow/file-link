// Add these constants at the top of the file, matching the backend limits
const MAX_FILE_SIZE = 500 * 1024 * 1024;  // 500MB
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024;  // 1GB

class DownloadManager {
    constructor(files, oneTimeDownload) {
        this.files = files;
        this.oneTimeDownload = oneTimeDownload;
        this.formData = new FormData(); // Initialize FormData here
        this.fileList = new Set(); // Track added files
        this.initializeEventListeners();
        console.log('DownloadManager initialized with', files.length, 'files');
    }

    initializeEventListeners() {
        // Get the drop zone element
        const dropZone = document.querySelector('.drop-zone');
        const dragOverlay = document.getElementById('dragOverlay');
        const fileInput = document.getElementById('fileInput');

        if (dropZone && dragOverlay) {
            // Prevent default drag behaviors
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, this.preventDefaults.bind(this), false);
                document.body.addEventListener(eventName, this.preventDefaults.bind(this), false);
            });

            // Highlight drop zone when dragging over it
            ['dragenter', 'dragover'].forEach(eventName => {
                dropZone.addEventListener(eventName, () => {
                    dragOverlay.classList.remove('hidden');
                    dropZone.classList.add('drag-active');
                });
            });

            ['dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, () => {
                    dragOverlay.classList.add('hidden');
                    dropZone.classList.remove('drag-active');
                });
            });

            // Handle dropped files
            dropZone.addEventListener('drop', (e) => {
                const droppedFiles = Array.from(e.dataTransfer.files);
                this.handleFiles(droppedFiles);
            });

            // Handle file input change
            if (fileInput) {
                fileInput.addEventListener('change', (e) => {
                    const selectedFiles = Array.from(e.target.files);
                    this.handleFiles(selectedFiles);
                    // Reset file input to allow selecting the same file again
                    fileInput.value = '';
                });
            }
        }
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    handleFiles(files) {
        // Validate individual file sizes and total size
        let totalSize = this.calculateCurrentTotalSize();
        const invalidFiles = [];
        const validFiles = [];

        for (const file of files) {
            // Check if file is already added
            if (this.fileList.has(file.name)) {
                invalidFiles.push({
                    name: file.name,
                    reason: 'already added'
                });
                continue;
            }

            if (file.size > MAX_FILE_SIZE) {
                invalidFiles.push({
                    name: file.name,
                    reason: `exceeds maximum file size of ${this.formatSize(MAX_FILE_SIZE)}`
                });
                continue;
            }
            
            totalSize += file.size;
            if (totalSize > MAX_TOTAL_SIZE) {
                invalidFiles.push({
                    name: file.name,
                    reason: 'would exceed total size limit'
                });
                continue;
            }

            validFiles.push(file);
            this.fileList.add(file.name);
        }

        // Add valid files to form data and display them
        validFiles.forEach(file => {
            this.formData.append('files', file);
            this.addFilePreview(file);
        });

        // Show any errors
        if (invalidFiles.length > 0) {
            const message = invalidFiles.map(f => 
                `${f.name}: ${f.reason}`
            ).join('\n');
            alert(`Some files cannot be uploaded:\n${message}`);
        }

        // Enable/disable submit button based on whether we have files
        this.updateSubmitButton();
    }

    calculateCurrentTotalSize() {
        let totalSize = 0;
        for (const [key, value] of this.formData.entries()) {
            if (value instanceof File) {
                totalSize += value.size;
            }
        }
        return totalSize;
    }

    addFilePreview(file) {
        const fileListElement = document.getElementById('fileList');
        if (!fileListElement) return;

        const fileElement = document.createElement('div');
        fileElement.className = 'file-card rounded-xl p-4 border border-gray-100';
        fileElement.dataset.fileName = file.name;
        
        fileElement.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="flex-shrink-0 w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
                    <svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                    </svg>
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 truncate">${file.name}</h3>
                    <p class="text-sm text-gray-500">${this.formatSize(file.size)}</p>
                </div>
                <button type="button" onclick="fileUploadManager.removeFile('${file.name}')"
                        class="text-gray-400 hover:text-red-500 transition-colors">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;
        
        fileListElement.appendChild(fileElement);
    }

    removeFile(fileName) {
        // Remove from FormData
        const newFormData = new FormData();
        for (const [key, value] of this.formData.entries()) {
            if (key === 'files' && value instanceof File && value.name === fileName) {
                continue;
            }
            newFormData.append(key, value);
        }
        this.formData = newFormData;
        this.fileList.delete(fileName);

        // Remove from UI
        const element = document.querySelector(`[data-file-name="${fileName}"]`);
        if (element) {
            element.remove();
        }

        this.updateSubmitButton();
    }

    // Add helper method to format file sizes
    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    async uploadFiles(formData) {
        try {
            // Create and show progress element
            const progressElement = this.createProgressElement();
            
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData,
                // Add signal to track upload progress
                signal: this.createProgressSignal(progressElement)
            });

            // Remove progress element after upload
            progressElement.remove();

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.detail || 'Upload failed');
            }

            this.showUploadResult(result);
        } catch (error) {
            console.error('Upload error:', error);
            // Don't show alert if it was an abort
            if (error.name !== 'AbortError') {
                alert(error.message || 'Upload failed. Please try again.');
            }
        }
    }

    createProgressElement() {
        const progressElement = document.createElement('div');
        progressElement.className = 'fixed bottom-4 right-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg z-50';
        progressElement.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="flex-1">
                    <div class="h-2 bg-gray-200 rounded-full">
                        <div class="progress-bar h-2 bg-blue-500 rounded-full w-0 transition-all duration-300"></div>
                    </div>
                    <div class="text-sm mt-2">
                        <span class="progress-text">Uploading...</span>
                        <button class="cancel-upload ml-2 text-red-500 hover:text-red-600">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(progressElement);

        // Add cancel handler
        const cancelButton = progressElement.querySelector('.cancel-upload');
        cancelButton.addEventListener('click', () => {
            if (this.abortController) {
                this.abortController.abort();
            }
        });

        return progressElement;
    }

    createProgressSignal(progressElement) {
        this.abortController = new AbortController();
        const progressBar = progressElement.querySelector('.progress-bar');
        const progressText = progressElement.querySelector('.progress-text');

        // Track upload progress
        const contentLength = Array.from(this.formData.values()).reduce((total, value) => {
            return total + (value instanceof File ? value.size : value.length);
        }, 0);

        let uploadedSize = 0;
        const upload = new TransformStream({
            transform(chunk, controller) {
                uploadedSize += chunk.length;
                const progress = (uploadedSize / contentLength) * 100;
                progressBar.style.width = `${progress}%`;
                progressText.textContent = `Uploading... ${Math.round(progress)}%`;
                controller.enqueue(chunk);
            }
        });

        return this.abortController.signal;
    }

    showUploadResult(result) {
        const resultsDiv = document.getElementById('results');
        const linkList = document.getElementById('linkList');

        if (resultsDiv && linkList) {
            resultsDiv.classList.remove('hidden');
            
            const shareUrl = `${window.location.origin}${result.share_url}`;
            const linkElement = document.createElement('div');
            linkElement.className = 'bg-gray-50 dark:bg-gray-700 rounded-lg p-4';
            linkElement.innerHTML = `
                <div class="flex items-center justify-between gap-4">
                    <input type="text" value="${shareUrl}" readonly
                           class="flex-1 bg-transparent border-0 focus:ring-0 text-sm text-gray-600 dark:text-gray-300">
                    <button onclick="navigator.clipboard.writeText('${shareUrl}')"
                            class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 transition-colors text-sm">
                        Copy Link
                    </button>
                </div>
                <div class="mt-2 text-sm text-gray-500">
                    <p>Expires: ${result.expiry_time}</p>
                    <p>Files: ${result.file_count}</p>
                    <p>Total size: ${result.total_size}</p>
                    ${result.one_time_download ? '<p class="text-orange-500">⚠️ One-time download link</p>' : ''}
                </div>
            `;

            linkList.innerHTML = '';
            linkList.appendChild(linkElement);
        }
    }
} 