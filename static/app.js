// Theme handling
function initTheme() {
    const theme = localStorage.getItem('theme') || 'light';
    document.body.classList.toggle('dark', theme === 'dark');
    updateThemeIcons(theme);
}

function updateThemeIcons(theme) {
    const darkIcon = document.getElementById('theme-toggle-dark-icon');
    const lightIcon = document.getElementById('theme-toggle-light-icon');
    
    if (theme === 'dark') {
        darkIcon.classList.add('hidden');
        lightIcon.classList.remove('hidden');
    } else {
        lightIcon.classList.add('hidden');
        darkIcon.classList.remove('hidden');
    }
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcons(isDark ? 'dark' : 'light');
}

// File upload handling
class FileUploadManager {
    constructor() {
        this.files = new Map();
        this.uploadForm = document.getElementById('uploadForm');
        this.fileInput = document.getElementById('fileInput');
        this.fileList = document.getElementById('fileList');
        this.dropZone = document.querySelector('.drop-zone');
        this.dragOverlay = document.getElementById('dragOverlay');
        this.submitButton = this.uploadForm.querySelector('button[type="submit"]');
        this.results = document.getElementById('results');
        this.linkList = document.getElementById('linkList');
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // File input change
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Drag and drop
        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

        // Form submission
        this.uploadForm.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    handleFileSelect(event) {
        const files = Array.from(event.target.files);
        this.addFiles(files);
    }

    handleDragOver(event) {
        event.preventDefault();
        this.dragOverlay.classList.remove('hidden');
    }

    handleDragLeave(event) {
        event.preventDefault();
        this.dragOverlay.classList.add('hidden');
    }

    handleDrop(event) {
        event.preventDefault();
        this.dragOverlay.classList.add('hidden');
        const files = Array.from(event.dataTransfer.files);
        this.addFiles(files);
    }

    addFiles(files) {
        files.forEach(file => {
            const fileId = crypto.randomUUID();
            this.files.set(fileId, file);
            this.addFilePreview(fileId, file);
        });
        
        this.updateSubmitButton();
    }

    addFilePreview(fileId, file) {
        const fileSize = this.formatSize(file.size);
        const fileElement = document.createElement('div');
        fileElement.className = 'file-card rounded-xl p-4 border border-gray-100';
        fileElement.dataset.fileId = fileId;
        
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
                    <p class="text-sm text-gray-500">${fileSize}</p>
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

    async handleSubmit(event) {
        event.preventDefault();
        
        const formData = new FormData();
        this.files.forEach(file => {
            formData.append('files', file);
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