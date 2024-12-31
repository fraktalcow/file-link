from fastapi import FastAPI, HTTPException, Request, File, UploadFile, Form, Header
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from cryptography.fernet import Fernet
from datetime import datetime
import logging
import asyncio
import secrets
import time
import mimetypes
import aiofiles
from pathlib import Path
import io
import zipfile
from typing import List, Dict, Optional
from pydantic import BaseModel, Field
import traceback
from urllib.parse import unquote
import os
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi.security import HTTPBasic

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize constants
STORAGE_PATH = Path("./uploads")
STORAGE_PATH.mkdir(exist_ok=True)  # Ensure uploads directory exists
DEFAULT_EXPIRY_HOURS = 24
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB
MAX_TOTAL_SIZE = 1024 * 1024 * 1024  # 1GB
FILE_CLEANUP_INTERVAL = 30  # minutes

ALLOWED_EXTENSIONS = {
    # Images
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
    # Documents
    '.pdf', '.doc', '.docx', '.txt', '.rtf', '.csv', '.xlsx', '.xls',
    # Archives
    '.zip', '.rar', '.7z', '.tar', '.gz',
    # Media
    '.mp3', '.mp4', '.wav', '.avi', '.mkv',
    # Code
    '.py', '.js', '.html', '.css', '.json', '.xml'
}

# Define models
class ShareGroup(BaseModel):
    group_id: str = Field(..., description="Unique identifier for the share group")
    files: Dict[str, dict] = Field(default_factory=dict, description="Files in the group")
    expiry: float = Field(..., description="Expiry timestamp")
    created_at: datetime = Field(default_factory=datetime.now, description="Creation timestamp")
    total_size: int = Field(default=0, description="Total size of all files")
    download_count: int = Field(default=0, description="Number of downloads")
    one_time_download: bool = Field(default=False, description="Whether files can only be downloaded once")
    encryption_key: bytes = Field(default_factory=lambda: Fernet.generate_key(), description="Encryption key for files")
    
    class Config:
        arbitrary_types_allowed = True

class Settings(BaseModel):
    """Application settings"""
    storage_path: str = "./uploads"
    default_expiry_hours: int = 24
    secret_key: str = secrets.token_urlsafe(32)

# Initialize global state
SHARE_GROUPS: Dict[str, ShareGroup] = {}
settings = Settings()

# Initialize FastAPI app
app = FastAPI(title="File Link", description="Secure file sharing service")
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with actual domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize security
# security = HTTPBasic()

# Utility functions
def format_size(size: int) -> str:
    """Convert bytes to human readable format"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"

def create_share_group(expiry_seconds: int) -> ShareGroup:
    """Create a new share group"""
    group_id = f"{int(time.time())}_{secrets.token_urlsafe(8)}"
    return ShareGroup(
        group_id=group_id,
        expiry=time.time() + expiry_seconds
    )

class EncryptedFileHandler:
    def __init__(self):
        self.cipher_suites = {}

    def get_cipher_suite(self, share_group: ShareGroup) -> Fernet:
        if share_group.group_id not in self.cipher_suites:
            self.cipher_suites[share_group.group_id] = Fernet(share_group.encryption_key)
        return self.cipher_suites[share_group.group_id]

    async def encrypt_file(self, file_content: bytes, share_group: ShareGroup) -> bytes:
        cipher_suite = self.get_cipher_suite(share_group)
        return cipher_suite.encrypt(file_content)

    async def decrypt_file(self, encrypted_content: bytes, share_group: ShareGroup) -> bytes:
        cipher_suite = self.get_cipher_suite(share_group)
        return cipher_suite.decrypt(encrypted_content)

# Initialize encryption handler
encrypted_file_handler = EncryptedFileHandler()

async def save_file(file: UploadFile, share_group: ShareGroup) -> dict:
    """Save uploaded file with improved filename handling"""
    try:
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"File type not allowed. Supported types: {', '.join(ALLOWED_EXTENSIONS)}"
            )
        
        # Create a safe filename by removing special characters and spaces
        safe_stem = "".join(c for c in Path(file.filename).stem if c.isalnum() or c in '_-')
        safe_filename = f"{safe_stem}_{secrets.token_hex(8)}{ext}"
        file_path = STORAGE_PATH / safe_filename
        
        contents = await file.read()
        file_size = len(contents)
        
        # Validate file size
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size: {format_size(MAX_FILE_SIZE)}"
            )
        
        if share_group.total_size + file_size > MAX_TOTAL_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Total size exceeds limit of {format_size(MAX_TOTAL_SIZE)}"
            )
        
        # Save file
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(contents)
        
        # Update share group total size
        share_group.total_size += file_size
        
        # Detect MIME type
        mime_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
        
        logger.info(f"File saved: {safe_filename} (original: {file.filename})")
        
        return {
            'original_name': file.filename,
            'stored_name': safe_filename,
            'mime_type': mime_type,
            'size': file_size,
            'downloads': 0,
            'created_at': datetime.now().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving file: {e}")
        if 'file_path' in locals() and file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail="Failed to save file")

async def cleanup_share_group(group_id: str):
    """Clean up a share group and its files"""
    if group_id in SHARE_GROUPS:
        share_group = SHARE_GROUPS[group_id]
        for filename in share_group.files:
            file_path = STORAGE_PATH / filename
            try:
                if file_path.exists():
                    await aiofiles.os.remove(file_path)  # Use aiofiles for async file removal
            except Exception as e:
                logger.error(f"Error deleting file {filename}: {e}")
        SHARE_GROUPS.pop(group_id)

async def cleanup_expired():
    """Remove expired share groups"""
    current_time = time.time()
    expired_groups = []
    
    for group_id, group in SHARE_GROUPS.items():
        if group.expiry < current_time:
            expired_groups.append(group_id)
            logger.info(f"Cleaning up expired group {group_id}, expired at {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(group.expiry))}")
    
    for group_id in expired_groups:
        await cleanup_share_group(group_id)

# API Endpoints
@app.get("/")
async def home_page(request: Request):
    """Render home page"""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "max_file_size": format_size(MAX_FILE_SIZE),
        "max_total_size": format_size(MAX_TOTAL_SIZE),
        "allowed_extensions": ", ".join(ALLOWED_EXTENSIONS)
    })

# Initialize the limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

# Add rate limit handler
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please try again later."}
    )

# Add a custom error handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    error_id = secrets.token_hex(8)
    logger.error(f"Error ID: {error_id}")
    logger.error(f"Request path: {request.url.path}")
    logger.error("Exception details:", exc_info=exc)
    
    return JSONResponse(
        status_code=500,
        content={
            "error_id": error_id,
            "detail": "An unexpected error occurred. Please try again later."
        }
    )

# Apply rate limiting to critical endpoints
@app.post("/upload")
@limiter.limit("10/minute")
async def upload_files(
    request: Request,
    files: List[UploadFile] = File(...),
    expiry_seconds: int = Form(DEFAULT_EXPIRY_HOURS * 3600),
    one_time_download: bool = Form(False)
):
    """Handle file uploads"""
    try:
        # Validate expiry time
        max_seconds = 168 * 3600  # 7 days
        if not 1 <= expiry_seconds <= max_seconds:
            raise HTTPException(
                status_code=400,
                detail=f"Expiry time must be between 1 second and {max_seconds} seconds (7 days)"
            )
        
        # Create share group with precise expiry time
        share_group = create_share_group(expiry_seconds)
        share_group.one_time_download = one_time_download
        
        # Log creation time and expiry time for debugging
        logger.info(f"Creating share group with expiry in {expiry_seconds} seconds")
        logger.info(f"Share group will expire at: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(share_group.expiry))}")
        
        # Save files
        for file in files:
            file_metadata = await save_file(file, share_group)
            share_group.files[file_metadata['stored_name']] = file_metadata
        
        # Store share group
        SHARE_GROUPS[share_group.group_id] = share_group
        
        return {
            'share_url': f"/download/{share_group.group_id}",
            'expiry_time': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(share_group.expiry)),
            'file_count': len(share_group.files),
            'total_size': format_size(share_group.total_size),
            'one_time_download': one_time_download
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail="Upload failed")

@app.get("/download/{group_id}")
async def download_page(request: Request, group_id: str):
    """Show download page"""
    if group_id not in SHARE_GROUPS:
        logger.info(f"Share group {group_id} not found")
        return templates.TemplateResponse("expired.html", {
            "request": request,
            "message": "This share link has expired or does not exist."
        })
    
    share_group = SHARE_GROUPS[group_id]
    current_time = time.time()
    
    if share_group.expiry < current_time:
        logger.info(f"Share group {group_id} expired at {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(share_group.expiry))}")
        await cleanup_share_group(group_id)
        return templates.TemplateResponse("expired.html", {
            "request": request,
            "message": "This share link has expired."
        })
    
    # Add logging for debugging
    logger.info(f"Serving share group {group_id}, expires at {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(share_group.expiry))}")
    
    files = []
    for stored_name, file_data in share_group.files.items():
        files.append({
            'original_name': file_data['original_name'],  # Original filename with extension
            'stored_name': stored_name,
            'size': format_size(file_data['size']),
            'downloads': file_data['downloads'],
            'download_url': f"/download/{group_id}/file/{stored_name}",
            'created_at': file_data['created_at'],
            'mime_type': file_data['mime_type']
        })
    
    return templates.TemplateResponse("download.html", {
        "request": request,
        "files": files,
        "expiry_time": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(share_group.expiry)),
        "created_at": share_group.created_at.strftime('%Y-%m-%d %H:%M:%S'),
        "total_size": format_size(share_group.total_size),
        "download_count": share_group.download_count,
        "one_time_download": share_group.one_time_download if hasattr(share_group, 'one_time_download') else False
    })

@app.get("/download/{group_id}/file/{filename}")
async def download_file(group_id: str, filename: str):
    """Handle file download with proper filename handling"""
    try:
        # Get share group
        share_group = SHARE_GROUPS.get(group_id)
        if not share_group:
            raise HTTPException(status_code=404, detail="Share link not found")

        # Check expiry
        if share_group.expiry < time.time():
            await cleanup_share_group(group_id)
            raise HTTPException(status_code=410, detail="Share link has expired")

        # Decode and sanitize the filename
        decoded_filename = unquote(filename)
        
        # Get file info
        file_info = share_group.files.get(decoded_filename)
        if not file_info:
            logger.error(f"File info not found for filename: {decoded_filename}")
            raise HTTPException(status_code=404, detail="File not found")

        # Construct file path safely
        file_path = STORAGE_PATH / decoded_filename
        if not file_path.exists() or not file_path.is_file():
            logger.error(f"File not found at path: {file_path}")
            raise HTTPException(status_code=404, detail="File not found")

        # Update download stats
        share_group.files[decoded_filename]['downloads'] += 1
        share_group.download_count += 1

        # Set proper headers for download
        headers = {
            "Content-Disposition": f'attachment; filename="{file_info["original_name"]}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }

        # Create response
        response = FileResponse(
            path=file_path,
            filename=file_info['original_name'],
            media_type=file_info['mime_type'],
            headers=headers
        )

        # Handle one-time downloads - cleanup only if it's a one-time download
        if share_group.one_time_download:
            # Schedule cleanup to run after response is sent
            asyncio.create_task(cleanup_share_group(group_id))
            logger.info(f"One-time download completed for group {group_id}, scheduled for cleanup")

        logger.info(f"Serving file: {decoded_filename} as {file_info['original_name']}")
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download error: {str(e)}")
        raise HTTPException(status_code=500, detail="Download failed")

@app.post("/upload-progress")
async def upload_progress(request: Request):
    """Stream upload progress"""
    async def progress_generator():
        while True:
            progress = request.state.upload_progress
            yield f"data: {progress}\n\n"
            await asyncio.sleep(0.1)
    
    return StreamingResponse(progress_generator(), media_type="text/event-stream")

async def compress_files(files: List[UploadFile]) -> bytes:
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for file in files:
            content = await file.read()
            zip_file.writestr(file.filename, content)
    return zip_buffer.getvalue()

@app.post("/compress-files")
async def compress_uploaded_files(files: List[UploadFile] = File(...)):
    """Compress multiple files before upload"""
    compressed_content = await compress_files(files)
    return StreamingResponse(
        io.BytesIO(compressed_content),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=compressed_files.zip"}
    )

# Add this function to help debug file storage
def verify_storage_path():
    """Verify storage path exists and is writable"""
    try:
        STORAGE_PATH.mkdir(exist_ok=True)
        test_file = STORAGE_PATH / '.test'
        test_file.touch()
        test_file.unlink()
        logger.info(f"Storage path verified: {STORAGE_PATH.absolute()}")
    except Exception as e:
        logger.error(f"Storage path error: {e}")
        raise

# Application setup
def setup_app():
    """Initialize application"""
    verify_storage_path()
    
    # Setup scheduler with less frequent cleanup
    scheduler = BackgroundScheduler()
    # Run cleanup every hour instead of every 30 minutes
    scheduler.add_job(cleanup_expired, 'interval', hours=1)
    scheduler.start()
    logger.info("Background scheduler started")

# Initialize app
setup_app()

@app.get("/download-all/{group_id}")
async def download_all_files(group_id: str):
    """Download all files in the share group as a zip file"""
    logger.info(f"Attempting to download all files for group: {group_id}")
    
    if group_id not in SHARE_GROUPS:
        logger.error(f"Share group {group_id} not found")
        raise HTTPException(status_code=404, detail="Share group not found")

    share_group = SHARE_GROUPS[group_id]
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for filename, file_data in share_group.files.items():
            file_path = STORAGE_PATH / filename
            if file_path.exists():
                logger.info(f"Adding {filename} to zip")
                zip_file.write(file_path, arcname=filename)
            else:
                logger.warning(f"File {filename} does not exist")

    zip_buffer.seek(0)
    logger.info("All files zipped successfully")
    return StreamingResponse(zip_buffer, media_type="application/zip", headers={"Content-Disposition": f"attachment; filename=all_files.zip"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
