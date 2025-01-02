// Theme handling with debug logging
function initTheme() {
    console.log('Initializing theme...');
    try {
        const theme = localStorage.getItem('theme') || 'light';
        document.body.classList.toggle('dark', theme === 'dark');
        console.log('Theme set to:', theme);
        
        // Only try to update theme icons if they exist
        const darkIcon = document.getElementById('theme-toggle-dark-icon');
        const lightIcon = document.getElementById('theme-toggle-light-icon');
        
        if (darkIcon && lightIcon) {
            console.log('Theme icons found, updating...');
            updateThemeIcons(theme);
        } else {
            console.log('Theme icons not found, skipping icon update');
        }
    } catch (error) {
        console.warn('Error initializing theme:', error);
    }
}

function updateThemeIcons(theme) {
    try {
        const darkIcon = document.getElementById('theme-toggle-dark-icon');
        const lightIcon = document.getElementById('theme-toggle-light-icon');
        
        if (!darkIcon || !lightIcon) {
            console.log('Theme icons not available for update');
            return;
        }
        
        if (theme === 'dark') {
            darkIcon.classList.add('hidden');
            lightIcon.classList.remove('hidden');
        } else {
            lightIcon.classList.add('hidden');
            darkIcon.classList.remove('hidden');
        }
        console.log('Theme icons updated successfully');
    } catch (error) {
        console.warn('Error updating theme icons:', error);
    }
}

function toggleTheme() {
    try {
        const isDark = document.body.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        updateThemeIcons(isDark ? 'dark' : 'light');
        console.log('Theme toggled to:', isDark ? 'dark' : 'light');
    } catch (error) {
        console.warn('Error toggling theme:', error);
    }
}

// File upload handling
class FileUploadManager {
    constructor() {
        this.files = new Map();
        this.uploadForm = document.getElementById('uploadForm');
        this.fileInput = document.getElementById('fileInput');
        this.directoryInput = document.getElementById('directoryInput');
        this.fileList = document.getElementById('fileList');
        this.dropZone = document.querySelector('.drop-zone');
        this.dragOverlay = document.getElementById('dragOverlay');
        this.submitButton = this.uploadForm.querySelector('button[type="submit"]');
        this.results = document.getElementById('results');
        this.linkList = document.getElementById('linkList');
        
        this.maxFileSize = 500 * 1024 * 1024; // 500MB
        this.maxTotalSize = 1024 * 1024 * 1024; // 1GB
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Prevent default drag behaviors on the entire document
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        // File input change
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Directory input change
        this.directoryInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Drag and drop events
        this.dropZone.addEventListener('dragenter', () => this.handleDragEnter());
        this.dropZone.addEventListener('dragover', () => this.handleDragOver());
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

        // Form submission
        this.uploadForm.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    handleDragEnter() {
        this.dragOverlay.classList.remove('hidden');
        this.dropZone.classList.add('drag-active');
    }

    handleDragOver() {
        this.dragOverlay.classList.remove('hidden');
        this.dropZone.classList.add('drag-active');
        return false;
    }

    handleDragLeave(e) {
        if (!e.relatedTarget || !this.dropZone.contains(e.relatedTarget)) {
            this.dragOverlay.classList.add('hidden');
            this.dropZone.classList.remove('drag-active');
        }
    }

    async handleDrop(e) {
        this.dragOverlay.classList.add('hidden');
        this.dropZone.classList.remove('drag-active');
        
        const items = Array.from(e.dataTransfer.items);
        
        // Handle dropped items (files or directories)
        for (const item of items) {
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    if (entry.isDirectory) {
                        await this.processDirectory(entry);
                    } else {
                        const file = item.getAsFile();
                        this.processFiles([file]);
                    }
                }
            }
        }
    }

    async processDirectory(dirEntry) {
        const files = await this.getAllFilesFromDirectory(dirEntry);
        this.processFiles(files);
    }

    getAllFilesFromDirectory(dirEntry) {
        const files = [];
        
        async function traverseDirectory(entry, path = '') {
            if (entry.isFile) {
                return new Promise((resolve) => {
                    entry.file((file) => {
                        // Add the full path to the file object
                        file.webkitRelativePath = path + file.name;
                        files.push(file);
                        resolve();
                    });
                });
            } else if (entry.isDirectory) {
                const dirReader = entry.createReader();
                const entries = await new Promise((resolve) => {
                    const results = [];
                    function readEntries() {
                        dirReader.readEntries((entries) => {
                            if (entries.length === 0) {
                                resolve(results);
                            } else {
                                results.push(...entries);
                                readEntries();
                            }
                        });
                    }
                    readEntries();
                });
                
                await Promise.all(entries.map((entry) => 
                    traverseDirectory(entry, path + entry.name + '/')
                ));
            }
        }
        
        return traverseDirectory(dirEntry).then(() => files);
    }

    handleFileSelect(event) {
        const selectedFiles = Array.from(event.target.files);
        this.processFiles(selectedFiles);
        // Reset file input to allow selecting the same file again
        event.target.value = '';
    }

    processFiles(newFiles) {
        // Calculate current total size
        let currentTotalSize = Array.from(this.files.values())
            .reduce((total, {file}) => total + file.size, 0);

        newFiles.forEach(file => {
            // Check file size
            if (file.size > this.maxFileSize) {
                this.showError(`File "${file.name}" exceeds maximum size of ${this.formatSize(this.maxFileSize)}`);
                return;
            }

            // Check total size
            if (currentTotalSize + file.size > this.maxTotalSize) {
                this.showError(`Adding "${file.name}" would exceed total size limit of ${this.formatSize(this.maxTotalSize)}`);
                return;
            }

            // Check file extension
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (!this.isAllowedExtension(ext)) {
                this.showError(`File type "${ext}" is not allowed`);
                return;
            }

            // Get relative path for directory structure
            const relativePath = file.webkitRelativePath || file.name;
            
            // Add file if it passes all checks
            const fileId = crypto.randomUUID();
            this.files.set(fileId, {
                file: file,
                relativePath: relativePath
            });
            this.addFilePreview(fileId, file, relativePath);
            currentTotalSize += file.size;
        });

        this.updateSubmitButton();
    }

    isAllowedExtension(ext) {
        const allowedExtensions = [
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
            '.pdf', '.doc', '.docx', '.txt', '.rtf', '.csv', '.xlsx', '.xls',
            '.zip', '.rar', '.7z', '.tar', '.gz',
            '.mp3', '.mp4', '.wav', '.avi', '.mkv',
            '.py', '.js', '.html', '.css', '.json', '.xml'
        ];
        return allowedExtensions.includes(ext.toLowerCase());
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'fixed bottom-4 right-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-lg';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 5000);
    }

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

    addFilePreview(fileId, file, relativePath) {
        const fileSize = this.formatSize(file.size);
        const fileElement = document.createElement('div');
        fileElement.className = 'file-card rounded-xl p-4 border border-gray-100';
        fileElement.dataset.fileId = fileId;
        
        // Get directory path if it exists
        const dirPath = relativePath.split('/').slice(0, -1).join('/');
        const dirDisplay = dirPath ? `<p class="text-xs text-blue-500">📁 ${dirPath}/</p>` : '';
        
        fileElement.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="flex-shrink-0 w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
                    <svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                    </svg>
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="text-lg font-semibold text-[#9aa5ce] truncate">${file.name}</h3>
                    ${dirDisplay}
                    <p class="text-sm text-[#9aa5ce]">${fileSize}</p>
                </div>
                <button type="button" onclick="fileUploadManager.removeFile('${fileId}')"
                        class="text-gray-400 hover:text-red-500 transition-colors">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;
        
        this.fileList.appendChild(fileElement);
    }

    removeFile(fileId) {
        this.files.delete(fileId);
        const element = this.fileList.querySelector(`[data-file-id="${fileId}"]`);
        if (element) {
            element.remove();
        }
        this.updateSubmitButton();
    }

    updateSubmitButton() {
        this.submitButton.disabled = this.files.size === 0;
    }

    async handleSubmit(event) {
        event.preventDefault();
        
        const formData = new FormData();
        this.files.forEach(({file, relativePath}, fileId) => {
            formData.append('files', file);
            formData.append('paths', relativePath);
        });
        
        // Add expiry time
        const hours = parseInt(this.uploadForm.querySelector('[name="expiry_hours"]').value) || 0;
        const minutes = parseInt(this.uploadForm.querySelector('[name="expiry_minutes"]').value) || 0;
        const seconds = parseInt(this.uploadForm.querySelector('[name="expiry_seconds"]').value) || 0;
        const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
        formData.append('expiry_seconds', totalSeconds);
        
        // Add one-time download option
        const oneTimeDownload = this.uploadForm.querySelector('#oneTimeDownload').checked;
        formData.append('one_time_download', oneTimeDownload);
        
        try {
            this.submitButton.disabled = true;
            this.submitButton.innerHTML = `
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Uploading...
            `;
            
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }
            
            const result = await response.json();
            this.showUploadResult(result);
            
        } catch (error) {
            console.error('Upload error:', error);
            alert('Upload failed. Please try again.');
        } finally {
            this.submitButton.disabled = false;
            this.submitButton.textContent = 'Share Files';
        }
    }

    showUploadResult(result) {
        // Clear file list
        this.fileList.innerHTML = '';
        this.files.clear();
        this.updateSubmitButton();
        
        // Show results
        this.results.classList.remove('hidden');
        
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
        
        this.linkList.innerHTML = '';
        this.linkList.appendChild(linkElement);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    
    // Initialize theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Initialize file upload manager if on upload page
    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) {
        window.fileUploadManager = new FileUploadManager();
    }
}); 