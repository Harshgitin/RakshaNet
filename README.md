# RakshaNet 🛡️

RakshaNet is an AI-assisted disaster response prototype focused on early warning, landslide risk assessment, live GIS data, emergency reporting, SOS support, volunteer coordination, and an admin dashboard.

## Tech stack
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js + Express
- Database: Supabase PostgreSQL
- Evidence storage: Supabase Storage
- GIS: OpenStreetMap / Overpass / OSRM
- Weather & warnings: IMD and Open-Meteo integrations
- ML: ONNX Runtime with a Random Forest landslide model

## Run locally
1. Install Node.js LTS.
2. Open this folder in VS Code.
3. Create a `.env` file from `.env.example`.
4. Add your own Supabase database URL, Supabase server-side secret key, and JWT secret. **Never commit `.env`.**
5. Install dependencies:
   ```bash
   npm install
   ```
6. Start the server:
   ```bash
   npm start
   ```
7. Open:
   http://localhost:5000

## Main API endpoints
- `GET /api/health` — backend health check
- `GET /api/db-test` — database connectivity test
- `POST /api/predict/landslide` — landslide ML inference
- `POST /api/auth/register` — register a user
- `POST /api/auth/login` — login
- `PUT /api/auth/profile/:id` — update profile
- `POST /api/admin/login` — administrator login
- `GET /api/dashboard` — admin dashboard data (JWT protected)
- `GET /api/reports` / `POST /api/reports` — emergency reports
- `GET /api/sos` / `POST /api/sos` — SOS alerts
- `GET /api/volunteers` / `POST /api/volunteers` — volunteers
- `GET /api/imd/district-warnings` — IMD district warning proxy
- `POST /api/gis/nearby` — Overpass GIS proxy

## Data & secrets
Supabase PostgreSQL is the primary persistent database for users, emergency reports, SOS alerts and volunteers. Evidence files are stored in the `rakshanet-evidence` Supabase Storage bucket.

The JSON files under `data/` are only safe local placeholders/legacy artifacts. `data/users.json` is intentionally ignored by Git because it can contain account information and password hashes.

Runtime uploads and generated weather cache files are also ignored by Git.

## Deployment
The same Node.js server can run on Render or another Node hosting platform. Configure the environment variables from `.env.example` in the hosting dashboard; do not upload secrets to GitHub.

## Current project scope
Real provider-based SMS alerts are **not enabled in the current build**. SMS/DLT integration is kept as future scope.
