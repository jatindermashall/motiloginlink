// Load environment variables
require('dotenv').config();

const express = require('express');
const csv = require('csv-parser');
const fs = require('fs');
const cors = require('cors');

/** ======== CONFIG ======== */
const PORT = process.env.PORT || 3000;
const DEFAULT_CSV_PATH = process.env.DEFAULT_CSV_PATH || '/mnt/data/magic_login_list.csv';
const API_ACCESS_KEY = process.env.API_ACCESS_KEY || ''; // set blank to disable

// CSV headers in your file
const EMAIL_COL = 'Email';
const LINK_COL = 'Login Link';

/** ======== APP SETUP ======== */
const app = express();
app.use(cors());
app.use(express.json());

function authGuard(req, res, next) {
  if (!API_ACCESS_KEY) return next(); // disabled
  const key = req.header('x-api-key');
  if (key !== API_ACCESS_KEY)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/** ======== STORE ======== */
let emailToLink = new Map();
let lastLoadedPath = DEFAULT_CSV_PATH;

function norm(str) {
  return (str ?? '').toString().trim().toLowerCase();
}

/** Load CSV into memory: Map<emailLower, loginLink> */
async function loadCsv(path = DEFAULT_CSV_PATH) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path))
      return reject(new Error(`CSV not found: ${path}`));

    const tmp = new Map();
    fs.createReadStream(path)
      .pipe(csv())
      .on('data', (row) => {
        const email = norm(row[EMAIL_COL]);
        const link = (row[LINK_COL] ?? '').toString().trim();
        if (email && link) {
          // first match wins; comment next line & uncomment following to let "last write wins"
          if (!tmp.has(email)) tmp.set(email, link);
          // tmp.set(email, link); // <-- use this line if you prefer last occurrence
        }
      })
      .on('end', () => {
        emailToLink = tmp;
        lastLoadedPath = path;
        resolve({ count: emailToLink.size, path });
      })
      .on('error', reject);
  });
}

/** ======== ROUTES ======== */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    loaded: emailToLink.size,
    csvPath: lastLoadedPath,
  });
});

/** Lookup via query string */
app.get('/lookup', (req, res) => {
  const email = norm(req.query.email);
  if (!email)
    return res.status(400).json({ error: 'Missing email query param' });

  const link = emailToLink.get(email);
  if (!link) return res.status(404).json({ error: 'Not found' });

  res.json({ email: req.query.email.trim(), loginLink: link });
});

/** Lookup via POST JSON { email } */
app.post('/lookup', authGuard, (req, res) => {
  const email = norm(req.body?.email);
  if (!email)
    return res.status(400).json({ error: 'Missing "email" in JSON body' });

  const link = emailToLink.get(email);
  if (!link) return res.status(404).json({ error: 'Not found' });

  res.json({
    email: (req.body.email ?? '').toString().trim(),
    loginLink: link,
  });
});

/** Reload CSV from disk (optionally pass { path } to switch file) */
app.post('/reload', authGuard, async (req, res) => {
  const path = (req.body?.path || DEFAULT_CSV_PATH).toString();
  try {
    const info = await loadCsv(path);
    res.json({ reloaded: true, ...info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ======== START ======== */
loadCsv(DEFAULT_CSV_PATH)
  .then((info) => {
    console.log(`📄 Loaded ${info.count} records from: ${info.path}`);
    app.listen(PORT, () =>
      console.log(`🚀 Lookup API running on http://localhost:${PORT}`)
    );
    console.log(`   GET  /lookup?email=user@example.com`);
    console.log(`   POST /lookup  { "email": "user@example.com" }`);
    console.log(`   POST /reload  { "path": "C:\\\\path\\\\to\\\\file.csv" }`);
  })
  .catch((err) => {
    console.error('Failed to load CSV:', err.message);
    process.exit(1);
  });
