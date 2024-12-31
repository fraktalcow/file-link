# FileShare Web Application

## Project Description
FileShare is a secure file sharing web application built using FastAPI. It allows users to upload files, share them via unique links, and set expiration times for those links. The application supports various file types and provides features like one-time downloads and file compression, ensuring a user-friendly experience for file management.

## Setup Instructions
To set up the FileShare application locally, follow these steps:

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/fraktalcow/file-link.git
   cd file-link
   ```

2. **Create a Virtual Environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```

3. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the Application:**
   ```bash
   uvicorn app:app --reload
   ```

5. **Access the Application:**
   Open your web browser and navigate to `http://127.0.0.1:8000`.

## Features Overview
- **File Uploads:** Users can upload files with a simple drag-and-drop interface.
- **Share Links:** Each uploaded file can be shared via a unique link.
- **Expiration Settings:** Users can set expiration times for shared links.
- **One-Time Download Links:** Files can be configured for one-time downloads.
- **File Compression:** Multiple files can be compressed before upload.
- **Responsive Design:** The application is styled using Tailwind CSS for a modern look.

## Basic Implementation
The FileShare application is structured into several key components:

1. **Backend (FastAPI):**
   - The main application file (`app.py`) initializes the FastAPI app and defines API endpoints for file uploads, downloads, and share group management.

2. **Frontend:**
   - The user interface is built using HTML, CSS, and JavaScript. The main page (`templates/index.html`) provides a form for file uploads, while `static/app.js` manages front-end interactions.

3. **File Management:**
   - Uploaded files are stored in a local directory (`./uploads`), and share groups are managed in-memory (can be extended to use a database).

4. **Security Features:**
   - Basic authentication and file encryption are implemented to ensure secure file handling.

5. **Rate Limiting:**
   - The application uses the `slowapi` library to prevent abuse of the upload endpoint.

## Conclusion
The FileShare application provides a robust solution for secure file sharing with a user-friendly interface. Each component plays a crucial role in ensuring smooth interactions and efficient file management.