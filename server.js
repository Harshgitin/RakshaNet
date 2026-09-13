require('dotenv').config();


const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const ort = require('onnxruntime-node');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const {
    createClient
} = require('@supabase/supabase-js');

const ROOT = __dirname;
const supabaseAdmin =
    createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SECRET_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        }
    );


const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('error', (error) => {
    console.error('PostgreSQL pool error:', error);
});
// =====================================================
// MACHINE LEARNING MODEL
// =====================================================

const ML_MODEL_FILE = path.join(
    ROOT,
    'ml',
    'landslide_model.onnx'
);

let landslideSessionPromise = null;

function getLandslideSession() {
    if (!landslideSessionPromise) {
        landslideSessionPromise =
            ort.InferenceSession.create(
                ML_MODEL_FILE
            );
    }

    return landslideSessionPromise;
}

const LANDSLIDE_FEATURES = [
    'rain_1d',
    'rain_3d',
    'rain_7d',
    'precip_1d',
    'precip_3d',
    'precip_7d',
    'precip_hours_1d',
    'precip_hours_3d',
    'precip_hours_7d',
    'temp_mean',
    'temp_max',
    'temp_min',
    'wind_max',
    'latitude',
    'longitude',
    'month'
];
const UPLOAD_DIR = path.join(ROOT, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });


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







app.get('/api/db-test', async (_req, res) => {
    try {
        const result = await pool.query('SELECT NOW() AS time');

        res.json({
            ok: true,
            database: 'connected',
            time: result.rows[0].time
        });
    } catch (error) {
        console.error('Database test error:', error);

        res.status(500).json({
            ok: false,
            database: 'connection_failed',
            error: error.message
        });
    }
});










// =====================================================
// AI / ML - LANDSLIDE PREDICTION
// =====================================================

app.post(
    '/api/predict/landslide',
    async (req, res) => {

        try {

            const body = req.body || {};

            // -------------------------------------------------
            // Validate all required features
            // -------------------------------------------------

            const values = LANDSLIDE_FEATURES.map(
                feature => Number(body[feature])
            );

            const invalid = values.some(
                value => !Number.isFinite(value)
            );

            if (invalid) {

                return res.status(400).json({
                    ok: false,
                    error:
                        'All landslide prediction features are required and must be numeric.',
                    requiredFeatures:
                        LANDSLIDE_FEATURES
                });

            }


            // -------------------------------------------------
            // Load model
            // -------------------------------------------------

            const session =
                await getLandslideSession();


            // -------------------------------------------------
            // Prepare ONNX input
            // -------------------------------------------------

            const inputTensor =
                new ort.Tensor(
                    'float32',
                    Float32Array.from(values),
                    [1, values.length]
                );


            const inputName =
                session.inputNames[0];


            const feeds = {};

            feeds[inputName] =
                inputTensor;


            // -------------------------------------------------
            // Run ML model
            // -------------------------------------------------

            const results =
                await session.run(feeds);


            // ONNX converted Random Forest normally exposes
            // "label" and "probabilities".
            // We inspect the available outputs so the API
            // remains robust to output-name differences.

            const outputNames =
                session.outputNames;


            let label = null;
            let probability = null;


            for (const name of outputNames) {

                const output =
                    results[name];

                if (!output) continue;


                const data =
                    output.data;


                if (!data || data.length === 0) {
                    continue;
                }


                // Binary probability output is
                // normally [probability_class_0,
                //           probability_class_1]

                if (
                    data.length >= 2 &&
                    probability === null
                ) {

                    probability =
                        Number(data[1]);

                }


                // Classification label
                if (
                    data.length === 1 &&
                    label === null
                ) {

                    label =
                        Number(data[0]);

                }

            }


            // -------------------------------------------------
            // Fallback probability
            // -------------------------------------------------

            if (
                probability === null ||
                !Number.isFinite(probability)
            ) {

                probability =
                    label === 1
                        ? 1
                        : 0;
            }


            probability =
                Math.max(
                    0,
                    Math.min(
                        1,
                        probability
                    )
                );


            const percentage =
                Math.round(
                    probability * 100
                );


            // -------------------------------------------------
            // Risk classification
            // -------------------------------------------------

            let risk;
            let priority;


            if (percentage >= 80) {

                risk = 'EXTREME';
                priority = 'P1 Critical';

            } else if (percentage >= 60) {

                risk = 'HIGH';
                priority = 'P2 High';

            } else if (percentage >= 35) {

                risk = 'WATCH';
                priority = 'P3 Watch';

            } else {

                risk = 'LOW';
                priority = 'P4 Normal';
            }


            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            return res.json({

                ok: true,

                model: 'rakshanet-landslide-v1',

                prediction: {

                    landslideProbability:
                        Number(
                            probability.toFixed(4)
                        ),

                    percentage,

                    risk,

                    priority,

                    predictedClass:
                        percentage >= 50
                            ? 1
                            : 0
                },

                features: Object.fromEntries(
                    LANDSLIDE_FEATURES.map(
                        (feature, index) => [
                            feature,
                            values[index]
                        ]
                    )
                ),

                message:
                    'Preliminary ML-based landslide risk estimate. Follow official warnings and local authorities for emergency decisions.'
            });


        } catch (error) {

            console.error(
                'Landslide ML prediction error:',
                error
            );


            return res.status(500).json({

                ok: false,

                error:
                    'Unable to run landslide prediction.',

                details:
                    error.message
            });
        }
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

        const normalizedMobile =
            String(mobile).replace(/\s+/g, '');

        const normalizedEmail =
            email
                ? String(email).trim().toLowerCase()
                : null;

        // Check Supabase for an existing account
        const existingUser = await pool.query(
            `
            SELECT id
            FROM public.users
            WHERE mobile = $1
               OR (
                    $2::text IS NOT NULL
                    AND email IS NOT NULL
                    AND LOWER(email) = LOWER($2)
               )
            LIMIT 1
            `,
            [
                normalizedMobile,
                normalizedEmail
            ]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                error:
                    'An account with this mobile number or email already exists.'
            });
        }

        const passwordHash =
            await bcrypt.hash(password, 12);

        const userId =
            `USER-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

        const location = {
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
        };

        const preferences =
            Array.isArray(alertPreferences)
                ? alertPreferences
                : [
                    'heavy_rain',
                    'flood',
                    'landslide',
                    'thunderstorm'
                ];

        await pool.query(
            `
            INSERT INTO public.users (
                id,
                name,
                mobile,
                email,
                password_hash,
                permanent_location,
                alert_preferences,
                status,
                created_at
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6::jsonb,
                $7::jsonb,
                $8,
                $9
            )
            `,
            [
                userId,
                String(name).trim(),
                normalizedMobile,
                normalizedEmail,
                passwordHash,
                JSON.stringify(location),
                JSON.stringify(preferences),
                'ACTIVE',
                new Date().toISOString()
            ]
        );

        return res.status(201).json({

            ok: true,

            user: {
                id: userId,
                name: String(name).trim(),
                mobile: normalizedMobile,
                email: normalizedEmail,
                permanentLocation: location,
                alertPreferences: preferences
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
                error:
                    'Mobile/email and password are required.'
            });

        }

        const value =
            String(identifier)
                .trim()
                .toLowerCase();

        const result = await pool.query(
            `
            SELECT
                id,
                name,
                mobile,
                email,
                password_hash,
                permanent_location,
                alert_preferences
            FROM public.users
            WHERE mobile = $1
               OR (
                    email IS NOT NULL
                    AND LOWER(email) = LOWER($1)
               )
            LIMIT 1
            `,
            [value]
        );

        if (result.rows.length === 0) {

            return res.status(401).json({
                error: 'Invalid login credentials.'
            });

        }

        const user =
            result.rows[0];

        const valid =
            await bcrypt.compare(
                password,
                user.password_hash
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
                    user.permanent_location,

                alertPreferences:
                    user.alert_preferences

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

        const {
            name,
            email,
            permanentLocation,
            latitude,
            longitude,
            alertPreferences
        } = req.body || {};

        const userResult = await pool.query(
            `
            SELECT
                id,
                name,
                mobile,
                email,
                permanent_location,
                alert_preferences
            FROM public.users
            WHERE id = $1
            LIMIT 1
            `,
            [req.params.id]
        );

        if (userResult.rows.length === 0) {

            return res.status(404).json({
                error: 'User not found.'
            });

        }

        const currentUser =
            userResult.rows[0];

        const newName =
            name !== undefined
                ? String(name).trim()
                : currentUser.name;

        const newEmail =
            email !== undefined
                ? (
                    String(email).trim()
                        ? String(email).trim().toLowerCase()
                        : null
                )
                : currentUser.email;

        let newLocation =
            currentUser.permanent_location;

        if (permanentLocation !== undefined) {

            newLocation = {

                name:
                    permanentLocation?.name ||
                    currentUser.permanent_location?.name ||
                    '',

                latitude:
                    Number.isFinite(Number(latitude))
                        ? Number(latitude)
                        : currentUser.permanent_location?.latitude ?? null,

                longitude:
                    Number.isFinite(Number(longitude))
                        ? Number(longitude)
                        : currentUser.permanent_location?.longitude ?? null

            };

        }

        const newPreferences =
            Array.isArray(alertPreferences)
                ? alertPreferences
                : currentUser.alert_preferences;

        const updated =
            await pool.query(
                `
                UPDATE public.users
                SET
                    name = $1,
                    email = $2,
                    permanent_location = $3::jsonb,
                    alert_preferences = $4::jsonb,
                    updated_at = $5
                WHERE id = $6
                RETURNING
                    id,
                    name,
                    mobile,
                    email,
                    permanent_location,
                    alert_preferences
                `,
                [
                    newName,
                    newEmail,
                    JSON.stringify(newLocation),
                    JSON.stringify(newPreferences),
                    new Date().toISOString(),
                    req.params.id
                ]
            );

        const user =
            updated.rows[0];

        return res.json({

            ok: true,

            user: {

                id: user.id,

                name: user.name,

                mobile: user.mobile,

                email: user.email,

                permanentLocation:
                    user.permanent_location,

                alertPreferences:
                    user.alert_preferences

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
// ADMIN AUTHENTICATION
// =====================================================







// =====================================================
// ADMIN LOGIN
// =====================================================

app.post(
    '/api/admin/login',
    async (req, res) => {

        try {

            const {
                identifier,
                password
            } = req.body || {};


            // -------------------------------------------------
            // Validate input
            // -------------------------------------------------

            if (
                !identifier ||
                !password
            ) {

                return res.status(400).json({
                    error:
                        'Mobile/email and password are required.'
                });

            }


            const value =
                String(identifier)
                    .trim()
                    .toLowerCase();


            // -------------------------------------------------
            // Find the account
            // -------------------------------------------------

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        name,
                        mobile,
                        email,
                        password_hash,
                        role,
                        status
                    FROM public.users
                    WHERE
                        mobile = $1
                        OR (
                            email IS NOT NULL
                            AND LOWER(email) = LOWER($1)
                        )
                    LIMIT 1
                    `,
                    [value]
                );


            if (result.rows.length === 0) {

                return res.status(401).json({
                    error:
                        'Invalid admin credentials.'
                });

            }


            const user =
                result.rows[0];


            // -------------------------------------------------
            // Verify password
            // -------------------------------------------------

            const passwordValid =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );


            if (!passwordValid) {

                return res.status(401).json({
                    error:
                        'Invalid admin credentials.'
                });

            }


            // -------------------------------------------------
            // Verify account status
            // -------------------------------------------------

            const status =
                String(
                    user.status || ''
                )
                    .trim()
                    .toUpperCase();


            if (
                status !== 'ACTIVE'
            ) {

                return res.status(403).json({
                    error:
                        'This account is not active.'
                });

            }


            // -------------------------------------------------
            // Verify ADMIN role
            // -------------------------------------------------

            const role =
                String(
                    user.role || ''
                )
                    .trim()
                    .toUpperCase();


            if (
                role !== 'ADMIN'
            ) {

                return res.status(403).json({
                    error:
                        'Administrator access is required.'
                });

            }


            // -------------------------------------------------
            // Create JWT
            // -------------------------------------------------

            const token =
                jwt.sign(
                    {
                        userId:
                            user.id,

                        role:
                            'ADMIN'
                    },

                    process.env.JWT_SECRET,

                    {
                        expiresIn:
                            '8h',

                        issuer:
                            'RakshaNet',

                        audience:
                            'RakshaNet-Admin'
                    }
                );


            // -------------------------------------------------
            // SUCCESS
            // -------------------------------------------------

            return res.json({

                ok: true,

                token,

                user: {

                    id:
                        user.id,

                    name:
                        user.name,

                    mobile:
                        user.mobile,

                    email:
                        user.email,

                    role:
                        'ADMIN'

                }

            });

        } catch (error) {

            console.error(
                'Admin login error:',
                error
            );

            return res.status(500).json({

                error:
                    'Unable to process admin login.',

                details:
                    error.message

            });

        }

    }
);








// =====================================================
// ADMIN AUTHENTICATION MIDDLEWARE
// =====================================================

function requireAdmin(req, res, next) {

    try {

        const authHeader =
            req.headers.authorization || '';


        if (
            !authHeader.startsWith(
                'Bearer '
            )
        ) {

            return res.status(401).json({
                error:
                    'Admin authentication required.'
            });

        }


        const token =
            authHeader
                .slice(7)
                .trim();


        if (!token) {

            return res.status(401).json({
                error:
                    'Admin authentication required.'
            });

        }


        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET,
                {
                    issuer: 'RakshaNet',
                    audience: 'RakshaNet-Admin'
                }
            );


        if (
            !decoded ||
            decoded.role !== 'ADMIN'
        ) {

            return res.status(403).json({
                error:
                    'Administrator access required.'
            });

        }


        req.admin =
            decoded;


        next();

    } catch (error) {

        console.error(
            'Admin authentication error:',
            error.message
        );

        return res.status(401).json({
            error:
                'Invalid or expired admin token.'
        });

    }

}












// =====================================================
// REPORTS
// =====================================================

app.get(
    '/api/reports',
    async (_req, res) => {

        try {

            const result = await pool.query(
                `
                SELECT
                    id,
                    reporter_name AS "reporterName",
                    contact,
                    incident_type AS "incidentType",
                    latitude,
                    longitude,
                    people_affected AS "peopleAffected",
                    injured,
                    trapped,
                    description,
                    priority,
                    timestamp,
                    status,
                    synced,
                    evidence
                FROM public.emergency_reports
                ORDER BY timestamp DESC
                `
            );

            return res.json(result.rows);

        } catch (error) {

            console.error(
                'Get reports error:',
                error
            );

            return res.status(500).json({
                error: 'Unable to load emergency reports.'
            });

        }

    }
);


app.delete(
    '/api/reports/:id',
    requireAdmin,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM public.emergency_reports
                    WHERE id = $1
                    RETURNING
                        id,
                        reporter_name AS "reporterName",
                        contact,
                        incident_type AS "incidentType",
                        latitude,
                        longitude,
                        people_affected AS "peopleAffected",
                        injured,
                        trapped,
                        description,
                        priority,
                        timestamp,
                        status,
                        synced,
                        evidence
                    `,
                    [req.params.id]
                );

            if (result.rows.length === 0) {

                return res.status(404).json({
                    error: 'Report not found.'
                });

            }

            return res.json({
                ok: true,
                deleted: result.rows[0]
            });

        } catch (error) {

            console.error(
                'Delete report error:',
                error
            );

            return res.status(500).json({
                error:
                    'Unable to delete report.',
                details:
                    error.message
            });

        }

    }
);


app.delete(
    '/api/reports',
    requireAdmin,
    async (_req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM public.emergency_reports
                    WHERE UPPER(COALESCE(status, '')) = 'RESOLVED'
                    RETURNING id
                    `
                );

            return res.json({

                ok: true,

                removed:
                    result.rowCount

            });

        } catch (error) {

            console.error(
                'Delete resolved reports error:',
                error
            );

            return res.status(500).json({

                error:
                    'Unable to delete resolved reports.',

                details:
                    error.message

            });

        }

    }
);


app.patch(
    '/api/reports/:id/resolve',
    requireAdmin,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE public.emergency_reports
                    SET
                        status = 'RESOLVED',
                        resolved_at = NOW()
                    WHERE id = $1
                    RETURNING
                        id,
                        reporter_name AS "reporterName",
                        contact,
                        incident_type AS "incidentType",
                        latitude,
                        longitude,
                        people_affected AS "peopleAffected",
                        injured,
                        trapped,
                        description,
                        priority,
                        timestamp,
                        status,
                        synced,
                        evidence,
                        resolved_at AS "resolvedAt"
                    `,
                    [req.params.id]
                );

            if (result.rows.length === 0) {

                return res.status(404).json({
                    error: 'Report not found.'
                });

            }

            return res.json({
                ok: true,
                report: result.rows[0]
            });

        } catch (error) {

            console.error(
                'Resolve report error:',
                error
            );

            return res.status(500).json({

                error:
                    'Unable to resolve report.',

                details:
                    error.message

            });

        }

    }
);


app.post(
    '/api/reports',
    upload.single('evidence'),
    async (req, res) => {

        try {

            const body =
                req.body || {};

            let priority = null;

            try {

                priority =
                    body.priority
                        ? JSON.parse(body.priority)
                        : null;

            } catch (_error) {

                priority = null;

            }

            const report = {

                id:
                    body.id ||
                    `RN-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,

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


            };











// =====================================================
// SUPABASE STORAGE - EVIDENCE UPLOAD
// =====================================================

if (req.file) {

    try {

        // Make a clean Storage object path.
        const safeFileName =
            String(req.file.filename)
                .replace(/[^a-zA-Z0-9._-]/g, "_");

        const storagePath =
            `reports/${report.id}/${safeFileName}`;

        const fileBuffer =
            fs.readFileSync(
                req.file.path
            );

        console.log(
            "Uploading evidence to Supabase Storage:",
            {
                bucket: "rakshanet-evidence",
                path: storagePath,
                size: fileBuffer.length,
                type: req.file.mimetype
            }
        );

        const uploadResult =
            await supabaseAdmin.storage
                .from("rakshanet-evidence")
                .upload(
                    storagePath,
                    fileBuffer,
                    {
                        contentType:
                            req.file.mimetype,

                        cacheControl:
                            "3600",

                        upsert:
                            true
                    }
                );

        if (uploadResult.error) {

            console.error(
                "Supabase Storage upload error:",
                uploadResult.error
            );

            return res.status(500).json({
                error:
                    "Evidence file could not be uploaded to cloud storage.",

                details:
                    uploadResult.error.message
            });

        }

        const publicUrlResult =
            supabaseAdmin.storage
                .from("rakshanet-evidence")
                .getPublicUrl(
                    storagePath
                );

        report.evidence = {

            name:
                req.file.originalname,

            url:
                publicUrlResult.data.publicUrl,

            path:
                storagePath,

            size:
                req.file.size,

            type:
                req.file.mimetype

        };

        // Remove the temporary local file.
        try {

            fs.unlinkSync(
                req.file.path
            );

        } catch (cleanupError) {

            console.warn(
                "Temporary evidence cleanup failed:",
                cleanupError.message
            );

        }

    } catch (storageError) {

        console.error(
            "Evidence storage error:",
            storageError
        );

        // Clean up the temporary local upload if Storage upload fails.
        try {
            if (req.file?.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        } catch (cleanupError) {
            console.warn(
                "Temporary evidence cleanup failed:",
                cleanupError.message
            );
        }

        return res.status(500).json({

            error:
                "Unable to store evidence file.",

            details:
                storageError.message

        });

    }

} else {

    report.evidence = null;

}









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


            await pool.query(
                `
                INSERT INTO public.emergency_reports (
                    id,
                    reporter_name,
                    contact,
                    incident_type,
                    latitude,
                    longitude,
                    people_affected,
                    injured,
                    trapped,
                    description,
                    priority,
                    timestamp,
                    status,
                    synced,
                    evidence
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11::jsonb,
                    $12,
                    $13,
                    $14,
                    $15::jsonb
                )
                `,
                [
                    report.id,
                    report.reporterName,
                    report.contact,
                    report.incidentType,
                    report.latitude,
                    report.longitude,
                    report.peopleAffected,
                    report.injured,
                    report.trapped,
                    report.description,
                    JSON.stringify(report.priority),
                    report.timestamp,
                    report.status,
                    report.synced,
                    JSON.stringify(report.evidence)
                ]
            );


            return res.status(201).json(
                report
            );

        } catch (error) {

            console.error(
                'Create report error:',
                error
            );

            return res.status(500).json({
                error:
                    'Unable to save emergency report.'
            });

        }

    }
);


// =====================================================
// SOS
// =====================================================

app.get(
    '/api/sos',
    async (_req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        latitude,
                        longitude,
                        description,
                        timestamp,
                        priority,
                        status,
                        synced
                    FROM public.sos_alerts
                    ORDER BY timestamp DESC
                    `
                );

            return res.json(
                result.rows
            );

        } catch (error) {

            console.error(
                'Get SOS alerts error:',
                error
            );

            return res.status(500).json({
                error:
                    'Unable to load SOS alerts.'
            });

        }

    }
);


app.post(
    '/api/sos',
    async (req, res) => {

        try {

            const body =
                req.body || {};

            const sos = {

                id:
                    body.id ||
                    `SOS-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,

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


            // -------------------------------------------------
            // Validate location
            // -------------------------------------------------

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


            // -------------------------------------------------
            // Save SOS to Supabase
            // -------------------------------------------------

            await pool.query(
                `
                INSERT INTO public.sos_alerts (
                    id,
                    latitude,
                    longitude,
                    description,
                    timestamp,
                    priority,
                    status,
                    synced
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8
                )
                `,
                [
                    sos.id,
                    sos.latitude,
                    sos.longitude,
                    sos.description,
                    sos.timestamp,
                    sos.priority,
                    sos.status,
                    sos.synced
                ]
            );


            return res.status(201).json(
                sos
            );

        } catch (error) {

            console.error(
                'Create SOS error:',
                error
            );

            return res.status(500).json({

                error:
                    'Unable to save SOS alert.',

                details:
                    error.message

            });

        }

    }
);


// =====================================================
// VOLUNTEERS
// =====================================================

app.get(
    '/api/volunteers',
    async (_req, res) => {

        try {

            const result = await pool.query(
                `
                SELECT
                    id,
                    name,
                    phone,
                    skill,
                    availability,
                    latitude,
                    longitude,
                    timestamp,
                    status,
                    synced
                FROM public.volunteers
                ORDER BY timestamp DESC
                `
            );

            return res.json(result.rows);

        } catch (error) {

            console.error(
                'Get volunteers error:',
                error
            );

            return res.status(500).json({
                error:
                    'Unable to load volunteers.'
            });

        }

    }
);


app.post(
    '/api/volunteers',
    async (req, res) => {

        try {

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
                    `VOL-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,

                name:
                    String(body.name).trim(),

                phone:
                    String(body.phone).trim(),

                skill:
                    body.skill ||
                    'General',

                availability:
                    body.availability ||
                    'Available now',

                latitude:
                    body.latitude !== undefined &&
                    body.latitude !== ''
                        ? Number(body.latitude)
                        : null,

                longitude:
                    body.longitude !== undefined &&
                    body.longitude !== ''
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


            if (
                volunteer.latitude !== null &&
                !Number.isFinite(
                    volunteer.latitude
                )
            ) {

                volunteer.latitude = null;

            }


            if (
                volunteer.longitude !== null &&
                !Number.isFinite(
                    volunteer.longitude
                )
            ) {

                volunteer.longitude = null;

            }


            await pool.query(
                `
                INSERT INTO public.volunteers (
                    id,
                    name,
                    phone,
                    skill,
                    availability,
                    latitude,
                    longitude,
                    timestamp,
                    status,
                    synced
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10
                )
                `,
                [
                    volunteer.id,
                    volunteer.name,
                    volunteer.phone,
                    volunteer.skill,
                    volunteer.availability,
                    volunteer.latitude,
                    volunteer.longitude,
                    volunteer.timestamp,
                    volunteer.status,
                    volunteer.synced
                ]
            );


            return res.status(201).json(
                volunteer
            );

        } catch (error) {

            console.error(
                'Create volunteer error:',
                error
            );

            return res.status(500).json({

                error:
                    'Unable to save volunteer.',

                details:
                    error.message

            });

        }

    }
);


// =====================================================
// DASHBOARD
// =====================================================

app.get(
    '/api/dashboard',
    requireAdmin,
    async (_req, res) => {

        try {

            // =================================================
            // LOAD EMERGENCY REPORTS FROM SUPABASE
            // =================================================

            const reportsResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        reporter_name AS "reporterName",
                        contact,
                        incident_type AS "incidentType",
                        latitude,
                        longitude,
                        people_affected AS "peopleAffected",
                        injured,
                        trapped,
                        description,
                        priority,
                        timestamp,
                        status,
                        synced,
                        evidence
                    FROM public.emergency_reports
                    ORDER BY timestamp DESC
                    `
                );


            // =================================================
            // LOAD SOS ALERTS FROM SUPABASE
            // =================================================

            const sosResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        latitude,
                        longitude,
                        description,
                        timestamp,
                        priority,
                        status,
                        synced
                    FROM public.sos_alerts
                    ORDER BY timestamp DESC
                    `
                );


            // =================================================
            // LOAD VOLUNTEERS FROM SUPABASE
            // =================================================

            const volunteersResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        name,
                        phone,
                        skill,
                        availability,
                        latitude,
                        longitude,
                        timestamp,
                        status,
                        synced
                    FROM public.volunteers
                    ORDER BY timestamp DESC
                    `
                );


            const reports =
                reportsResult.rows;

            const sos =
                sosResult.rows;

            const volunteers =
                volunteersResult.rows;


            // =================================================
            // DASHBOARD SUMMARY
            // =================================================

            const summary = {

                reports:
                    reports.length,

                criticalReports:
                    reports.filter(
                        report =>
                            report.priority?.label ===
                            'P1 Critical'
                    ).length,

                activeSOS:
                    sos.filter(
                        alert =>
                            String(
                                alert.status || ''
                            ).toUpperCase() !==
                            'RESOLVED'
                    ).length,

                volunteers:
                    volunteers.length,

                availableVolunteers:
                    volunteers.filter(
                        volunteer =>
                            String(
                                volunteer.availability || ''
                            ).toLowerCase() !==
                            'not available'
                    ).length

            };


            // =================================================
            // RESPONSE
            // =================================================

            return res.json({

                summary,

                reports,

                sos,

                volunteers

            });

        } catch (error) {

            console.error(
                'Dashboard error:',
                error
            );

            return res.status(500).json({

                error:
                    'Unable to load dashboard data.',

                details:
                    error.message

            });

        }

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
//
// Fast multi-provider strategy:
// - Query multiple Overpass servers in parallel
// - Return the first successful response
// - Each provider has a short timeout
// - A slow provider does not block the others
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

            // -------------------------------------------------
            // Overpass providers
            // -------------------------------------------------

            const overpassServers = [

                'https://overpass-api.de/api/interpreter',

                'https://overpass.kumi.systems/api/interpreter',

                'https://overpass.private.coffee/api/interpreter'

            ];

            // -------------------------------------------------
            // Request helper
            // -------------------------------------------------

            async function requestOverpass(endpoint) {

                console.log(
                    'Trying Overpass:',
                    endpoint
                );

                const response =
                    await fetch(
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

                            // Much faster failure handling
                            signal:
                                AbortSignal.timeout(10000)
                        }
                    );

                const text =
                    await response.text();

                if (!response.ok) {

                    throw new Error(
                        `HTTP ${response.status}: ${text.slice(0, 300)}`
                    );

                }

                if (!text.trim()) {

                    throw new Error(
                        'Empty response from Overpass provider.'
                    );

                }

                console.log(
                    'Overpass success:',
                    endpoint
                );

                return text;

            }

            // -------------------------------------------------
            // Run all providers in parallel
            // -------------------------------------------------

            const requests =
                overpassServers.map(
                    endpoint =>
                        requestOverpass(endpoint)
                );

            // -------------------------------------------------
            // Return the first successful provider
            // -------------------------------------------------

            try {

                const text =
                    await Promise.any(requests);

                return res
                    .status(200)
                    .type('application/json')
                    .send(text);

            } catch (aggregateError) {

                console.error(
                    'All Overpass providers failed.'
                );

                if (
                    aggregateError &&
                    Array.isArray(
                        aggregateError.errors
                    )
                ) {

                    aggregateError.errors.forEach(
                        (error, index) => {

                            console.warn(
                                `Overpass provider ${index + 1} failed:`,
                                error?.message
                            );

                        }
                    );

                }

                return res.status(502).json({

                    error:
                        'All GIS services are currently unavailable.',

                    details:
                        'All Overpass providers timed out or returned an error.'

                });

            }

        } catch (error) {

            console.error(
                'GIS proxy error:',
                error
            );

            return res.status(500).json({

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
    async () => {

        console.log(
            `RakshaNet backend running on port ${PORT}`
        );

        try {
            const result = await pool.query(
                'SELECT NOW() AS time'
            );

            console.log(
                'Supabase PostgreSQL connected:',
                result.rows[0].time
            );

        } catch (error) {

            console.error(
                'Supabase PostgreSQL connection failed:',
                error
            );

        }

    }
);