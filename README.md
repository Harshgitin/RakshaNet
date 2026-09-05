# RakshaNet

## Run with the new backend
1. Install Node.js (LTS).
2. Open this folder in VS Code.
3. Open Terminal in this folder.
4. Run:
   ```bash
   npm install
   npm start
   ```
5. Open:
   http://localhost:5000

## Backend endpoints
- GET /api/health
- GET/POST /api/reports
- GET/POST /api/sos
- GET/POST /api/volunteers
- GET /api/dashboard
- /uploads for stored evidence files

Emergency reports, SOS requests and volunteers are saved in `data/*.json`. Uploaded evidence is saved in `uploads/`.

This is a hackathon/local backend. For production/cloud deployment, move the same API to a hosted server and replace JSON files with a managed database/object storage service.
