const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

const FILES = {
  reports: path.join(DATA_DIR, 'reports.json'),
  sos: path.join(DATA_DIR, 'sos.json'),
  volunteers: path.join(DATA_DIR, 'volunteers.json')
};
for (const file of Object.values(FILES)) if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function pushRecord(file, record, limit = 1000) {
  const arr = readJson(file);
  arr.unshift(record);
  writeJson(file, arr.slice(0, limit));
  return record;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'RakshaNet Backend', time: new Date().toISOString() }));

app.get('/api/reports', (_req, res) => res.json(readJson(FILES.reports)));

app.delete('/api/reports/:id', (req, res) => {
  const reports = readJson(FILES.reports);
  const index = reports.findIndex(r => String(r.id) === String(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Report not found.' });
  const [deleted] = reports.splice(index, 1);
  writeJson(FILES.reports, reports);
  res.json({ ok: true, deleted });
});

app.delete('/api/reports', (_req, res) => {
  const reports = readJson(FILES.reports);
  const kept = reports.filter(r => String(r.status || '').toUpperCase() !== 'RESOLVED');
  const removed = reports.length - kept.length;
  writeJson(FILES.reports, kept);
  res.json({ ok: true, removed });
});

app.patch('/api/reports/:id/resolve', (req, res) => {
  const reports = readJson(FILES.reports);
  const report = reports.find(r => String(r.id) === String(req.params.id));
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  report.status = 'RESOLVED';
  report.resolvedAt = new Date().toISOString();
  writeJson(FILES.reports, reports);
  res.json({ ok: true, report });
});
app.post('/api/reports', upload.single('evidence'), (req, res) => {
  const body = req.body || {};
  const report = {
    id: body.id || `RN-${Date.now()}`,
    reporterName: body.reporterName || 'Anonymous',
    contact: body.contact || '',
    incidentType: body.incidentType || 'Other',
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
    peopleAffected: Number(body.peopleAffected || 0),
    injured: Number(body.injured || 0),
    trapped: Number(body.trapped || 0),
    description: body.description || '',
    priority: body.priority ? JSON.parse(body.priority) : null,
    timestamp: body.timestamp || new Date().toISOString(),
    status: 'NEW',
    synced: true,
    evidence: req.file ? { name: req.file.originalname, url: `/uploads/${req.file.filename}`, size: req.file.size, type: req.file.mimetype } : null
  };
  if (!Number.isFinite(report.latitude) || !Number.isFinite(report.longitude)) return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
  pushRecord(FILES.reports, report);
  res.status(201).json(report);
});

app.get('/api/sos', (_req, res) => res.json(readJson(FILES.sos)));
app.post('/api/sos', (req, res) => {
  const body = req.body || {};
  const sos = {
    id: body.id || `SOS-${Date.now()}`,
    latitude: Number(body.latitude), longitude: Number(body.longitude),
    description: body.description || 'Immediate rescue requested.',
    timestamp: body.timestamp || new Date().toISOString(),
    priority: 'P1 Critical', status: 'NEW', synced: true
  };
  if (!Number.isFinite(sos.latitude) || !Number.isFinite(sos.longitude)) return res.status(400).json({ error: 'Valid location is required.' });
  pushRecord(FILES.sos, sos, 1000);
  res.status(201).json(sos);
});

app.get('/api/volunteers', (_req, res) => res.json(readJson(FILES.volunteers)));
app.post('/api/volunteers', (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.phone) return res.status(400).json({ error: 'Volunteer name and phone are required.' });
  const volunteer = {
    id: body.id || `VOL-${Date.now()}`,
    name: body.name, phone: body.phone,
    skill: body.skill || 'General', availability: body.availability || 'Available now',
    latitude: body.latitude ? Number(body.latitude) : null,
    longitude: body.longitude ? Number(body.longitude) : null,
    timestamp: body.timestamp || new Date().toISOString(), status: 'REGISTERED', synced: true
  };
  pushRecord(FILES.volunteers, volunteer, 2000);
  res.status(201).json(volunteer);
});

app.get('/api/dashboard', (_req, res) => {
  const reports = readJson(FILES.reports);
  const sos = readJson(FILES.sos);
  const volunteers = readJson(FILES.volunteers);
  res.json({
    summary: {
      reports: reports.length,
      criticalReports: reports.filter(r => r.priority?.label === 'P1 Critical').length,
      activeSOS: sos.filter(s => s.status !== 'RESOLVED').length,
      volunteers: volunteers.length,
      availableVolunteers: volunteers.filter(v => v.availability !== 'Not available').length
    },
    reports, sos, volunteers
  });
});

app.use(express.static(ROOT));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`RakshaNet backend running on port ${PORT}`);
});