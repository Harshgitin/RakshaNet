const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
}

const FILES = {
    reports: path.join(DATA_DIR, 'reports.json'),
    sos: path.join(DATA_DIR, 'sos.json'),
    volunteers: path.join(DATA_DIR, 'volunteers.json'),
    users: path.join(DATA_DIR, 'users.json')
};

for (const file of Object.values(FILES)) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '[]');
    }
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return [];
    }
}

function writeJson(file, value) {
    fs.writeFileSync(
        file,
        JSON.stringify(value, null, 2)
    );
}

function pushRecord(file, record, limit = 1000) {
    const arr = readJson(file);

    arr.unshift(record);

    writeJson(
        file,
        arr.slice(0, limit)
    );

    return record;
}


// =====================================================
// EXPRESS APP
// =====================================================

const app = express();

app.use(cors());

app.use(
    express.json({
        limit: '2mb'
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: '2mb'
    })
);

app.use(
    '/uploads',
    express.static(UPLOAD_DIR)
);


// =====================================================
// FILE UPLOAD
// =====================================================

const storage = multer.diskStorage({

    destination: (_req, _file, cb) => {
        cb(null, UPLOAD_DIR);
    },

    filename: (_req, file, cb) => {

        const safeName =
            file.originalname.replace(
                /[^a-zA-Z0-9._-]/g,
                '_'
            );

        cb(
            null,
            `${Date.now()}-${safeName}`
        );
    }

});

const upload = multer({

    storage,

    limits: {
        fileSize: 15 * 1024 * 1024
    }

});


// =====================================================
// HEALTH
// =====================================================

app.get(
    '/api/health',
    (_req, res) => {

        res.json({
            ok: true,
            service: 'RakshaNet Backend',
            time: new Date().toISOString()
        });

    }
);




// =====================================================
// AUTHENTICATION
// =====================================================

// Register
app.post('/api/auth/register', async (req, res) => {

    try {

        const {
            name,
            mobile,
            email,
            password,
            permanentLocation,
            latitude,
            longitude,
            alertPreferences
        } = req.body || {};

        if (!name || !mobile || !password) {
            return res.status(400).json({
                error: 'Name, mobile number and password are required.'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: 'Password must contain at least 6 characters.'
            });
        }

        const users = readJson(FILES.users);

        const normalizedMobile = String(mobile).replace(/\s+/g, '');

        const existingUser = users.find(
            user =>
                user.mobile === normalizedMobile ||
                (
                    email &&
                    user.email &&
                    user.email.toLowerCase() ===
                    String(email).toLowerCase()
                )
        );

        if (existingUser) {
            return res.status(409).json({
                error: 'An account with this mobile number or email already exists.'
            });
        }

        const passwordHash =
            await bcrypt.hash(password, 12);

        const user = {

            id: `USER-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,

            name: String(name).trim(),

            mobile: normalizedMobile,

            email:
                email
                    ? String(email).trim().toLowerCase()
                    : '',

            passwordHash,

            permanentLocation: {

                name:
                    permanentLocation?.name ||
                    '',

                latitude:
                    Number.isFinite(Number(latitude))
                        ? Number(latitude)
                        : null,

                longitude:
                    Number.isFinite(Number(longitude))
                        ? Number(longitude)
                        : null

            },

            alertPreferences:
                Array.isArray(alertPreferences)
                    ? alertPreferences
                    : [
                        'heavy_rain',
                        'flood',
                        'landslide',
                        'thunderstorm'
                    ],

            createdAt:
                new Date().toISOString(),

            status:
                'ACTIVE'

        };

        pushRecord(
            FILES.users,
            user,
            10000
        );

        return res.status(201).json({

            ok: true,

            user: {
                id: user.id,
                name: user.name,
                mobile: user.mobile,
                email: user.email,
                permanentLocation:
                    user.permanentLocation,
                alertPreferences:
                    user.alertPreferences
            }

        });

    } catch (error) {

        console.error(
            'Registration error:',
            error
        );

        return res.status(500).json({
            error: 'Unable to create account.'
        });

    }

});





// Login
app.post('/api/auth/login', async (req, res) => {

    try {

        const {
            identifier,
            password
        } = req.body || {};

        if (!identifier || !password) {

            return res.status(400).json({
                error: 'Mobile/email and password are required.'
            });

        }

        const users = readJson(FILES.users);

        const value =
            String(identifier)
                .trim()
                .toLowerCase();

        const user =
            users.find(u =>
                u.mobile === value ||
                (
                    u.email &&
                    u.email.toLowerCase() === value
                )
            );

        if (!user) {

            return res.status(401).json({
                error: 'Invalid login credentials.'
            });

        }

        const valid =
            await bcrypt.compare(
                password,
                user.passwordHash
            );

        if (!valid) {

            return res.status(401).json({
                error: 'Invalid login credentials.'
            });

        }

        return res.json({

            ok: true,

            user: {
                id: user.id,
                name: user.name,
                mobile: user.mobile,
                email: user.email,
                permanentLocation:
                    user.permanentLocation,
                alertPreferences:
                    user.alertPreferences
            }

        });

    } catch (error) {

        console.error(
            'Login error:',
            error
        );

        return res.status(500).json({
            error: 'Unable to login.'
        });

    }

});





// Update user profile
app.put('/api/auth/profile/:id', async (req, res) => {

    try {

        const users = readJson(FILES.users);

        const user =
            users.find(
                u =>
                    String(u.id) ===
                    String(req.params.id)
            );

        if (!user) {

            return res.status(404).json({
                error: 'User not found.'
            });

        }

        const {
            name,
            email,
            permanentLocation,
            latitude,
            longitude,
            alertPreferences
        } = req.body || {};

        if (name !== undefined) {
            user.name = String(name).trim();
        }

        if (email !== undefined) {
            user.email =
                String(email).trim().toLowerCase();
        }

        if (permanentLocation !== undefined) {

            user.permanentLocation = {

                name:
                    permanentLocation?.name ||
                    user.permanentLocation?.name ||
                    '',

                latitude:
                    Number.isFinite(Number(latitude))
                        ? Number(latitude)
                        : user.permanentLocation?.latitude ?? null,

                longitude:
                    Number.isFinite(Number(longitude))
                        ? Number(longitude)
                        : user.permanentLocation?.longitude ?? null

            };

        }

        if (Array.isArray(alertPreferences)) {
            user.alertPreferences = alertPreferences;
        }

        user.updatedAt =
            new Date().toISOString();

        writeJson(
            FILES.users,
            users
        );

        return res.json({

            ok: true,

            user: {
                id: user.id,
                name: user.name,
                mobile: user.mobile,
                email: user.email,
                permanentLocation:
                    user.permanentLocation,
                alertPreferences:
                    user.alertPreferences
            }

        });

    } catch (error) {

        console.error(
            'Profile update error:',
            error
        );

        return res.status(500).json({
            error: 'Unable to update profile.'
        });

    }

});







// =====================================================
// AUTHENTICATION
// =====================================================

// REGISTER
app.post('/api/auth/register', async (req, res) => {

    try {

        const {
            name,
            mobile,
            email,
            password,
            permanentLocation,
            latitude,
            longitude,
            alertPreferences
        } = req.body || {};

        if (!name || !mobile || !password) {
            return res.status(400).json({
                error: 'Name, mobile number and password are required.'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: 'Password must contain at least 6 characters.'
            });
        }

        const users = readJson(FILES.users);

        const normalizedMobile =
            String(mobile).replace(/\s+/g, '');

        const normalizedEmail =
            email
                ? String(email).trim().toLowerCase()
                : '';

        const existingUser = users.find(user =>
            user.mobile === normalizedMobile ||
            (
                normalizedEmail &&
                user.email === normalizedEmail
            )
        );

        if (existingUser) {
            return res.status(409).json({
                error:
                    'An account with this mobile number or email already exists.'
            });
        }

        const passwordHash =
            await bcrypt.hash(password, 12);

        const user = {

            id:
                `USER-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,

            name:
                String(name).trim(),

            mobile:
                normalizedMobile,

            email:
                normalizedEmail,

            passwordHash:

                passwordHash,

            permanentLocation: {

                name:
                    permanentLocation?.name || '',

                latitude:
                    Number.isFinite(Number(latitude))
                        ? Number(latitude)
                        : null,

                longitude:
                    Number.isFinite(Number(longitude))
                        ? Number(longitude)
                        : null
            },

            alertPreferences:
                Array.isArray(alertPreferences)
                    ? alertPreferences
                    : [
                        'heavy_rain',
                        'flood',
                        'landslide',
                        'thunderstorm'
                    ],

            createdAt:
                new Date().toISOString(),

            status:
                'ACTIVE'
        };

        pushRecord(
            FILES.users,
            user,
            10000
        );

        return res.status(201).json({

            ok: true,

            user: {

                id: user.id,

                name: user.name,

                mobile: user.mobile,

                email: user.email,

                permanentLocation:
                    user.permanentLocation,

                alertPreferences:
                    user.alertPreferences

            }

        });

    } catch (error) {

        console.error(
            'Registration error:',
            error
        );

        return res.status(500).json({
            error: 'Unable to create account.'
        });

    }

});


// LOGIN
app.post('/api/auth/login', async (req, res) => {

    try {

        const {
            identifier,
            password
        } = req.body || {};

        if (!identifier || !password) {

            return res.status(400).json({
                error:
                    'Mobile/email and password are required.'
            });

        }

        const users =
            readJson(FILES.users);

        const value =
            String(identifier)
                .trim()
                .toLowerCase();

        const user =
            users.find(u =>
                u.mobile === value ||
                (
                    u.email &&
                    u.email.toLowerCase() === value
                )
            );

        if (!user) {

            return res.status(401).json({
                error:
                    'Invalid login credentials.'
            });

        }

        const valid =
            await bcrypt.compare(
                password,
                user.passwordHash
            );

        if (!valid) {

            return res.status(401).json({
                error:
                    'Invalid login credentials.'
            });

        }

        return res.json({

            ok: true,

            user: {

                id: user.id,

                name: user.name,

                mobile: user.mobile,

                email: user.email,

                permanentLocation:
                    user.permanentLocation,

                alertPreferences:
                    user.alertPreferences

            }

        });

    } catch (error) {

        console.error(
            'Login error:',
            error
        );

        return res.status(500).json({
            error: 'Unable to login.'
        });

    }

});











// =====================================================
// REPORTS
// =====================================================

app.get(
    '/api/reports',
    (_req, res) => {

        res.json(
            readJson(FILES.reports)
        );

    }
);


app.delete(
    '/api/reports/:id',
    (req, res) => {

        const reports =
            readJson(FILES.reports);

        const index =
            reports.findIndex(
                r =>
                    String(r.id) ===
                    String(req.params.id)
            );

        if (index === -1) {

            return res.status(404).json({
                error: 'Report not found.'
            });

        }

        const [deleted] =
            reports.splice(index, 1);

        writeJson(
            FILES.reports,
            reports
        );

        res.json({
            ok: true,
            deleted
        });

    }
);


app.delete(
    '/api/reports',
    (_req, res) => {

        const reports =
            readJson(FILES.reports);

        const kept =
            reports.filter(
                r =>
                    String(r.status || '')
                        .toUpperCase() !==
                    'RESOLVED'
            );

        const removed =
            reports.length -
            kept.length;

        writeJson(
            FILES.reports,
            kept
        );

        res.json({
            ok: true,
            removed
        });

    }
);


app.patch(
    '/api/reports/:id/resolve',
    (req, res) => {

        const reports =
            readJson(FILES.reports);

        const report =
            reports.find(
                r =>
                    String(r.id) ===
                    String(req.params.id)
            );

        if (!report) {

            return res.status(404).json({
                error: 'Report not found.'
            });

        }

        report.status = 'RESOLVED';

        report.resolvedAt =
            new Date().toISOString();

        writeJson(
            FILES.reports,
            reports
        );

        res.json({
            ok: true,
            report
        });

    }
);


app.post(
    '/api/reports',
    upload.single('evidence'),
    (req, res) => {

        const body =
            req.body || {};

        let priority = null;

        try {

            priority =
                body.priority
                    ? JSON.parse(body.priority)
                    : null;

        } catch (error) {

            priority = null;

        }

        const report = {

            id:
                body.id ||
                `RN-${Date.now()}`,

            reporterName:
                body.reporterName ||
                'Anonymous',

            contact:
                body.contact ||
                '',

            incidentType:
                body.incidentType ||
                'Other',

            latitude:
                Number(body.latitude),

            longitude:
                Number(body.longitude),

            peopleAffected:
                Number(
                    body.peopleAffected || 0
                ),

            injured:
                Number(
                    body.injured || 0
                ),

            trapped:
                Number(
                    body.trapped || 0
                ),

            description:
                body.description ||
                '',

            priority,

            timestamp:
                body.timestamp ||
                new Date().toISOString(),

            status:
                'NEW',

            synced:
                true,

            evidence:
                req.file
                    ? {
                        name:
                            req.file.originalname,

                        url:
                            `/uploads/${req.file.filename}`,

                        size:
                            req.file.size,

                        type:
                            req.file.mimetype
                    }
                    : null

        };


        if (
            !Number.isFinite(
                report.latitude
            ) ||
            !Number.isFinite(
                report.longitude
            )
        ) {

            return res.status(400).json({
                error:
                    'Valid latitude and longitude are required.'
            });

        }


        pushRecord(
            FILES.reports,
            report
        );

        res.status(201).json(
            report
        );

    }
);


// =====================================================
// SOS
// =====================================================

app.get(
    '/api/sos',
    (_req, res) => {

        res.json(
            readJson(FILES.sos)
        );

    }
);


app.post(
    '/api/sos',
    (req, res) => {

        const body =
            req.body || {};

        const sos = {

            id:
                body.id ||
                `SOS-${Date.now()}`,

            latitude:
                Number(body.latitude),

            longitude:
                Number(body.longitude),

            description:
                body.description ||
                'Immediate rescue requested.',

            timestamp:
                body.timestamp ||
                new Date().toISOString(),

            priority:
                'P1 Critical',

            status:
                'NEW',

            synced:
                true

        };


        if (
            !Number.isFinite(
                sos.latitude
            ) ||
            !Number.isFinite(
                sos.longitude
            )
        ) {

            return res.status(400).json({
                error:
                    'Valid location is required.'
            });

        }


        pushRecord(
            FILES.sos,
            sos,
            1000
        );


        res.status(201).json(
            sos
        );

    }
);


// =====================================================
// VOLUNTEERS
// =====================================================

app.get(
    '/api/volunteers',
    (_req, res) => {

        res.json(
            readJson(FILES.volunteers)
        );

    }
);


app.post(
    '/api/volunteers',
    (req, res) => {

        const body =
            req.body || {};


        if (
            !body.name ||
            !body.phone
        ) {

            return res.status(400).json({
                error:
                    'Volunteer name and phone are required.'
            });

        }


        const volunteer = {

            id:
                body.id ||
                `VOL-${Date.now()}`,

            name:
                body.name,

            phone:
                body.phone,

            skill:
                body.skill ||
                'General',

            availability:
                body.availability ||
                'Available now',

            latitude:
                body.latitude
                    ? Number(body.latitude)
                    : null,

            longitude:
                body.longitude
                    ? Number(body.longitude)
                    : null,

            timestamp:
                body.timestamp ||
                new Date().toISOString(),

            status:
                'REGISTERED',

            synced:
                true

        };


        pushRecord(
            FILES.volunteers,
            volunteer,
            2000
        );


        res.status(201).json(
            volunteer
        );

    }
);


// =====================================================
// DASHBOARD
// =====================================================

app.get(
    '/api/dashboard',
    (_req, res) => {

        const reports =
            readJson(FILES.reports);

        const sos =
            readJson(FILES.sos);

        const volunteers =
            readJson(FILES.volunteers);


        res.json({

            summary: {

                reports:
                    reports.length,

                criticalReports:
                    reports.filter(
                        r =>
                            r.priority?.label ===
                            'P1 Critical'
                    ).length,

                activeSOS:
                    sos.filter(
                        s =>
                            s.status !==
                            'RESOLVED'
                    ).length,

                volunteers:
                    volunteers.length,

                availableVolunteers:
                    volunteers.filter(
                        v =>
                            v.availability !==
                            'Not available'
                    ).length

            },

            reports,
            sos,
            volunteers

        });

    }
);


// =====================================================
// LIVE IMD PROXY
// Browser -> RakshaNet -> IMD
// =====================================================

app.get(
    '/api/imd/district-warnings',
    async (_req, res) => {

        try {

            const imdUrl =
                'https://mausam.imd.gov.in/api/warnings_district_api.php';


            const response =
                await fetch(
                    imdUrl,
                    {
                        method: 'GET',

                        headers: {
                            'User-Agent':
                                'RakshaNet/1.0',

                            'Accept':
                                'application/json,text/plain,*/*'
                        }
                    }
                );


            const text =
                await response.text();


            if (!response.ok) {

                console.error(
                    'IMD returned:',
                    response.status,
                    text
                );

                return res.status(
                    response.status
                ).json({

                    error:
                        'IMD request failed.',

                    upstreamStatus:
                        response.status

                });

            }


            res
                .status(200)
                .type('application/json')
                .send(text);


        } catch (error) {

            console.error(
                'IMD proxy error:',
                error
            );


            res.status(502).json({

                error:
                    'Unable to reach IMD service.'

            });

        }

    }
);


// =====================================================
// LIVE OVERPASS GIS PROXY
// Browser -> RakshaNet -> Overpass
// =====================================================

app.post(
    '/api/gis/nearby',
    async (req, res) => {

        try {

            const query = req.body?.query;

            if (
                !query ||
                typeof query !== 'string'
            ) {

                return res.status(400).json({
                    error: 'Valid Overpass query is required.'
                });

            }

            // Try multiple Overpass servers.
            // If one is unavailable, RakshaNet automatically
            // tries the next one.

            const overpassServers = [

                'https://overpass-api.de/api/interpreter',

                'https://overpass.kumi.systems/api/interpreter',

                'https://overpass.private.coffee/api/interpreter'

            ];

            let lastError = null;

            for (const endpoint of overpassServers) {

                try {

                    console.log(
                        'Trying Overpass:',
                        endpoint
                    );

                    const response = await fetch(
                        endpoint,
                        {
                            method: 'POST',

                            headers: {
                                'Content-Type':
                                    'application/x-www-form-urlencoded',

                                'User-Agent':
                                    'RakshaNet/1.0',

                                'Accept':
                                    'application/json'
                            },

                            body:
                                new URLSearchParams({
                                    data: query
                                }),

                            signal:
                                AbortSignal.timeout(25000)
                        }
                    );

                    const text =
                        await response.text();

                    if (!response.ok) {

                        throw new Error(
                            `HTTP ${response.status}: ${text.slice(0, 300)}`
                        );

                    }

                    console.log(
                        'Overpass success:',
                        endpoint
                    );

                    return res
                        .status(200)
                        .type('application/json')
                        .send(text);

                }

                catch (error) {

                    console.warn(
                        'Overpass failed:',
                        endpoint,
                        error.message
                    );

                    lastError = error;

                }

            }

            console.error(
                'All Overpass servers failed:',
                lastError?.message
            );

            return res.status(502).json({

                error:
                    'All GIS services are currently unavailable.',

                details:
                    lastError?.message || 'Unknown error'

            });

        }

        catch (error) {

            console.error(
                'GIS proxy error:',
                error
            );

            res.status(500).json({

                error:
                    'GIS proxy failed.',

                details:
                    error.message

            });

        }

    }
);


// =====================================================
// STATIC WEBSITE
// =====================================================

app.use(
    express.static(ROOT)
);


app.get(
    '/',
    (_req, res) => {

        res.sendFile(
            path.join(
                ROOT,
                'index.html'
            )
        );

    }
);


// =====================================================
// SERVER
// =====================================================

const PORT =
    process.env.PORT || 5000;


app.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            `RakshaNet backend running on port ${PORT}`
        );

    }
);