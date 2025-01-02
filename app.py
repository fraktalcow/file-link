from fastapi import FastAPI, HTTPException, File, UploadFile, Form, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from datetime import datetime
import logging
import asyncio
import secrets
import time
import mimetypes
import aiofiles
from pathlib import Path
from typing import List, Dict
from pydantic import BaseModel, Field
from apscheduler.schedulers.background import BackgroundScheduler
import traceback
from urllib.parse import unquote
import os

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
app = FastAPI(
    title="FileShare",
    description="Secure file sharing service",
    # Increase maximum upload size
    max_upload_size=MAX_TOTAL_SIZE
)
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
security = HTTPBasic()

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
    timestamp = int(time.time())
    token = secrets.token_urlsafe(8)
    group_id = f"{timestamp}_{token}"
    
    logger.info(f"Creating new share group with ID: {group_id}")
    logger.info(f"Expiry seconds: {expiry_seconds}")
    logger.info(f"Expiry time will be: {datetime.fromtimestamp(timestamp + expiry_seconds)}")
    
    # Ensure the ID is unique
    while group_id in SHARE_GROUPS:
        logger.warning(f"Group ID collision detected: {group_id}")
        token = secrets.token_urlsafe(8)
        group_id = f"{timestamp}_{token}"
        logger.info(f"Generated new group ID: {group_id}")
    
    share_group = ShareGroup(
        group_id=group_id,
        expiry=timestamp + expiry_seconds
    )
    
    logger.info(f"Share group created successfully: {group_id}")
    return share_group

async def save_file(file: UploadFile, relative_path: str, share_group: ShareGroup) -> dict:
    """Save uploaded file with chunked reading, maintaining directory structure"""
    try:
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"File type not allowed. Supported types: {', '.join(ALLOWED_EXTENSIONS)}"
            )
        
        # Create a safe filename while maintaining directory structure
        path_parts = relative_path.split('/')
        safe_filename = path_parts[-1]
        safe_path_parts = []
        
        # Process directory structure
        for part in path_parts[:-1]:
            safe_part = "".join(c for c in part if c.isalnum() or c in '_-')
            safe_path_parts.append(safe_part)
        
        # Add unique identifier to filename
        safe_stem = "".join(c for c in Path(safe_filename).stem if c.isalnum() or c in '_-')
        safe_filename = f"{safe_stem}_{secrets.token_hex(8)}{ext}"
        
        # Combine path parts
        if safe_path_parts:
            dir_path = STORAGE_PATH.joinpath(*safe_path_parts)
            dir_path.mkdir(parents=True, exist_ok=True)
            file_path = dir_path / safe_filename
            stored_path = '/'.join(safe_path_parts) + '/' + safe_filename
        else:
            file_path = STORAGE_PATH / safe_filename
            stored_path = safe_filename
        
        # Read and write file in chunks
        file_size = 0
        chunk_size = 1024 * 1024  # 1MB chunks
        
        async with aiofiles.open(file_path, 'wb') as f:
            while chunk := await file.read(chunk_size):
                await f.write(chunk)
                file_size += len(chunk)
                
                # Check size limits
                if file_size > MAX_FILE_SIZE:
                    await f.close()
                    await aiofiles.os.remove(file_path)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Maximum size: {format_size(MAX_FILE_SIZE)}"
                    )
        
        if share_group.total_size + file_size > MAX_TOTAL_SIZE:
            await aiofiles.os.remove(file_path)
            raise HTTPException(
                status_code=400,
                detail=f"Total size exceeds limit of {format_size(MAX_TOTAL_SIZE)}"
            )
        
        # Update share group total size
        share_group.total_size += file_size
        
        # Detect MIME type
        mime_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
        
        logger.info(f"File saved: {stored_path} (original: {relative_path})")
        
        return {
            'original_name': relative_path,
            'stored_name': stored_path,
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
            await aiofiles.os.remove(file_path)
        raise HTTPException(status_code=500, detail="Failed to save file")

async def cleanup_share_group(group_id: str):
    """Clean up a share group and its files"""
    logger.info(f"Starting cleanup for share group: {group_id}")
    if group_id in SHARE_GROUPS:
        share_group = SHARE_GROUPS[group_id]
        logger.info(f"Found share group {group_id} with {len(share_group.files)} files")
        
        # Get all unique directories to clean up
        directories = set()
        for filename in share_group.files:
            file_path = STORAGE_PATH / filename
            try:
                if file_path.exists():
                    await aiofiles.os.remove(file_path)
                    directories.add(file_path.parent)
                    logger.info(f"Deleted file: {file_path}")
                else:
                    logger.warning(f"File not found during cleanup: {file_path}")
            except Exception as e:
                logger.error(f"Error deleting file {filename}: {e}")
        
        # Clean up empty directories
        for directory in sorted(directories, reverse=True):
            try:
                if directory != STORAGE_PATH and directory.exists() and not any(directory.iterdir()):
                    directory.rmdir()
                    logger.info(f"Removed empty directory: {directory}")
            except Exception as e:
                logger.error(f"Error removing directory {directory}: {e}")
        
        SHARE_GROUPS.pop(group_id)
        logger.info(f"Share group {group_id} removed. Remaining groups: {list(SHARE_GROUPS.keys())}")
    else:
        logger.warning(f"Share group {group_id} not found during cleanup")

def cleanup_expired():
    """Remove expired share groups"""
    current_time = time.time()
    logger.info("Starting expired share groups cleanup")
    logger.info(f"Current share groups before cleanup: {list(SHARE_GROUPS.keys())}")
    
    expired_groups = [
        group_id for group_id, group in SHARE_GROUPS.items()
        if group.expiry < current_time
    ]
    
    if expired_groups:
        logger.info(f"Found {len(expired_groups)} expired groups: {expired_groups}")
        for group_id in expired_groups:
            asyncio.create_task(cleanup_share_group(group_id))
    else:
        logger.info("No expired groups found")
    
    logger.info(f"Current share groups after cleanup: {list(SHARE_GROUPS.keys())}")

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
@limiter.limit("10/minute")  # Limit to 10 uploads per minute per IP
async def upload_files(
    request: Request,
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...),
    expiry_seconds: int = Form(DEFAULT_EXPIRY_HOURS * 3600),
    one_time_download: bool = Form(False)
):
    """Handle file uploads"""
    try:
        logger.info(f"Starting upload process with {len(files)} files")
        logger.info(f"Current share groups before upload: {list(SHARE_GROUPS.keys())}")
        
        # Validate expiry time
        max_seconds = 168 * 3600  # 7 days
        if not 1 <= expiry_seconds <= max_seconds:
            raise HTTPException(
                status_code=400,
                detail="Expiry time must be between 1 second and 7 days"
            )
        
        if len(files) != len(paths):
            raise HTTPException(
                status_code=400,
                detail="Number of files and paths must match"
            )
        
        # Create share group
        share_group = create_share_group(expiry_seconds)
        share_group.one_time_download = one_time_download
        logger.info(f"Created new share group: {share_group.group_id}")
        
        file_errors = []
        
        # Process files with validation
        for file, path in zip(files, paths):
            try:
                logger.info(f"Processing file: {path}")
                file_metadata = await save_file(file, path, share_group)
                share_group.files[file_metadata['stored_name']] = file_metadata
                logger.info(f"Successfully saved file: {path} ({format_size(file_metadata['size'])})")
                
            except Exception as e:
                logger.error(f"Error processing file {path}: {str(e)}")
                file_errors.append({"filename": path, "error": str(e)})
                continue
        
        if not share_group.files:
            raise HTTPException(status_code=400, detail="No valid files were uploaded")
        
        # Store share group
        SHARE_GROUPS[share_group.group_id] = share_group
        logger.info(f"Share group {share_group.group_id} saved with {len(share_group.files)} files")
        logger.info(f"Current share groups after upload: {list(SHARE_GROUPS.keys())}")
        
        response_data = {
            'share_url': f"/download/{share_group.group_id}",
            'expiry_time': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(share_group.expiry)),
            'file_count': len(share_group.files),
            'total_size': format_size(share_group.total_size),
            'one_time_download': one_time_download
        }
        
        if file_errors:
            response_data['errors'] = file_errors
            
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/download/{group_id}")
async def download_page(request: Request, group_id: str):
    """Show download page"""
    if group_id not in SHARE_GROUPS:
        return templates.TemplateResponse("expired.html", {
            "request": request,
            "message": "This share link has expired or does not exist."
        })
    
    share_group = SHARE_GROUPS[group_id]
    if share_group.expiry < time.time():
        await cleanup_share_group(group_id)
        return templates.TemplateResponse("expired.html", {
            "request": request,
            "message": "This share link has expired."
        })
    
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
@limiter.limit("10/minute")  # Limit to 30 downloads per minute per IP
async def download_file(request: Request, group_id: str, filename: str):
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

        # Handle one-time downloads
        if share_group.one_time_download:
            asyncio.create_task(cleanup_share_group(group_id))

        # Set proper headers for download
        headers = {
            "Content-Disposition": f'attachment; filename="{file_info["original_name"]}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }

        logger.info(f"Serving file: {decoded_filename} as {file_info['original_name']}")

        return FileResponse(
            path=file_path,
            filename=file_info['original_name'],
            media_type=file_info['mime_type'],
            headers=headers
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download error: {str(e)}")
        raise HTTPException(status_code=500, detail="Download failed")

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
    
    # Setup scheduler
    scheduler = BackgroundScheduler()
    scheduler.add_job(cleanup_expired, 'interval', minutes=FILE_CLEANUP_INTERVAL)
    scheduler.start()

# Initialize app
setup_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
