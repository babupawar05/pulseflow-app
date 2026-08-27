const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const dbPath = path.join(__dirname, 'fitness.db');
const csvPath = path.join(__dirname, 'fitness_records.csv');

// --- 1. REAL-TIME EXCEL / CSV DISK SYNC ---
function exportToExcelCSV() {
  const query = `SELECT id, name, email, age, gender, weight, height, steps, water, completedWorkouts, created_at FROM users`;
  db.all(query, [], (err, rows) => {
    if (err) return console.error('CSV Export Error:', err.message);

    const headers = ['User ID', 'Full Name', 'Email', 'Age', 'Gender', 'Weight (kg)', 'Height (cm)', 'Total Steps', 'Water (L)', 'Completed Workouts', 'Registered At'];
    const csvRows = [headers.join(',')];

    (rows || []).forEach(r => {
      let workouts = '';
      try { workouts = JSON.parse(r.completedWorkouts || '[]').join('; '); } catch (e) { workouts = ''; }
      const cleanName = `"${(r.name || '').replace(/"/g, '""')}"`;
      const cleanEmail = `"${(r.email || '').replace(/"/g, '""')}"`;
      const cleanWorkouts = `"${workouts.replace(/"/g, '""')}"`;

      csvRows.push([
        r.id,
        cleanName,
        cleanEmail,
        r.age,
        r.gender,
        r.weight,
        r.height,
        r.steps,
        r.water,
        cleanWorkouts,
        `"${r.created_at}"`
      ].join(','));
    });

    try {
      fs.writeFileSync(csvPath, csvRows.join('\r\n'), 'utf8');
      console.log(`📊 Excel Sheet Synchronized: fitness_records.csv (${(rows || []).length} records)`);
    } catch (writeErr) {
      console.error('File write error:', writeErr.message);
    }
  });
}

// --- 2. DATABASE INITIALIZATION ---
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ SQLite Database successfully connected (fitness.db)');
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT,
      age INTEGER,
      gender TEXT,
      weight REAL,
      height REAL,
      steps INTEGER DEFAULT 0,
      water REAL DEFAULT 0.0,
      completedWorkouts TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, () => {
    exportToExcelCSV();
  });
});

// --- 3. PWA ASSETS ---
app.get('/icon.svg', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#10b981"/>
          <stop offset="100%" stop-color="#06b6d4"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="#070913"/>
      <path d="M280 64L136 296h112l-32 152 160-232H264z" fill="url(#grad)" stroke="#10b981" stroke-width="8" stroke-linejoin="round"/>
    </svg>
  `);
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    name: "PulseFlow Fitness OS",
    short_name: "PulseFlow",
    description: "Personal Biometric Fitness Tracker & OS",
    start_url: "/",
    display: "standalone",
    background_color: "#070913",
    theme_color: "#070913",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "192x192 512x512",
        type: "image/svg+xml",
        purpose: "any maskable"
      }
    ]
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    const CACHE_NAME = 'pulseflow-v3';
    const ASSETS = ['/', '/manifest.json', '/icon.svg'];

    self.addEventListener('install', (event) => {
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
      self.skipWaiting();
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      );
      self.clients.claim();
    });

    self.addEventListener('fetch', (event) => {
      if (event.request.url.includes('/api/')) return;
      event.respondWith(caches.match(event.request).then((resp) => resp || fetch(event.request)));
    });
  `);
});

// --- 4. BACKEND API ROUTES ---
app.get('/api/export-excel', (req, res) => {
  const query = `SELECT id, name, email, age, gender, weight, height, steps, water, completedWorkouts, created_at FROM users`;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).send('Database read error: ' + err.message);

    const headers = 'User ID,Full Name,Email,Age,Gender,Weight (kg),Height (cm),Total Steps,Water (L),Completed Workouts,Registered At\r\n';
    const body = (rows || []).map(r => {
      let workouts = '';
      try { workouts = JSON.parse(r.completedWorkouts || '[]').join('; '); } catch (e) { workouts = ''; }
      const cleanName = `"${(r.name || '').replace(/"/g, '""')}"`;
      const cleanEmail = `"${(r.email || '').replace(/"/g, '""')}"`;
      const cleanWorkouts = `"${workouts.replace(/"/g, '""')}"`;
      return `${r.id},${cleanName},${cleanEmail},${r.age},${r.gender},${r.weight},${r.height},${r.steps},${r.water},${cleanWorkouts},"${r.created_at}"`;
    }).join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fitness_records.csv"');
    res.send(headers + body);
  });
});

app.get('/api/users', (req, res) => {
  db.all('SELECT id, name, email, age, gender, weight, height, steps, water, completedWorkouts, created_at FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/register', async (req, res) => {
  const { email, password, name, age, gender, weight, height } = req.body;
  if (!email || !password || !name || !age || !weight || !height) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO users (email, password, name, age, gender, weight, height) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    
    db.run(sql, [email.toLowerCase().trim(), hashedPassword, name.trim(), age, gender, weight, height], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'An account with this email already exists.' });
        }
        return res.status(500).json({ error: err.message });
      }
      exportToExcelCSV();
      res.json({ success: true, userId: this.lastID });
    });
  } catch (err) {
    res.status(500).json({ error: 'Encryption failure.' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const sql = `SELECT * FROM users WHERE email = ?`;
  db.get(sql, [email.toLowerCase().trim()], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    const safeUser = { ...user };
    delete safeUser.password;
    try { safeUser.completedWorkouts = JSON.parse(safeUser.completedWorkouts || '[]'); } catch (e) { safeUser.completedWorkouts = []; }
    res.json({ success: true, user: safeUser });
  });
});

app.post('/api/update-profile', (req, res) => {
  const { id, name, age, gender, weight, height } = req.body;
  if (!id || !name || !age || !weight || !height) {
    return res.status(400).json({ error: 'Missing required profile values.' });
  }

  const sql = `UPDATE users SET name = ?, age = ?, gender = ?, weight = ?, height = ? WHERE id = ?`;
  db.run(sql, [name.trim(), age, gender, weight, height, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    exportToExcelCSV();
    res.json({ success: true });
  });
});

app.post('/api/sync', (req, res) => {
  const { id, steps, water, completedWorkouts } = req.body;
  if (!id) return res.status(400).json({ error: 'User ID missing.' });

  const sql = `UPDATE users SET steps = ?, water = ?, completedWorkouts = ? WHERE id = ?`;
  db.run(sql, [steps, water, JSON.stringify(completedWorkouts || []), id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    exportToExcelCSV();
    res.json({ success: true });
  });
});

// --- 5. FRONTEND UI & LOGIC ---
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>PulseFlow // Fitness OS</title>

  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#070913" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="PulseFlow" />
  <link rel="apple-touch-icon" href="/icon.svg" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #070913;
      --card-bg: rgba(16, 22, 38, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-green: #10b981;
      --accent-cyan: #06b6d4;
      --accent-orange: #f97316;
      --accent-rose: #f43f5e;
      --accent-purple: #a855f7;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg-dark);
      background-image: 
        radial-gradient(at 0% 0%, rgba(6, 182, 212, 0.12) 0px, transparent 45%),
        radial-gradient(at 100% 0%, rgba(168, 85, 247, 0.10) 0px, transparent 40%),
        radial-gradient(at 50% 100%, rgba(16, 185, 129, 0.10) 0px, transparent 50%);
      color: #fff; min-height: 100vh; display: flex; justify-content: center; padding: 16px 14px 90px;
    }
    .app-container { width: 100%; max-width: 650px; display: flex; flex-direction: column; gap: 16px; }
    .nav-bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 4px; }
    .brand-logo {
      font-family: 'Space Grotesk', sans-serif; font-size: 1.4rem; font-weight: 800;
      background: linear-gradient(45deg, var(--accent-green), var(--accent-cyan));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      display: flex; align-items: center; gap: 6px;
    }
    .nav-actions { display: flex; gap: 6px; align-items: center; }
    .pwa-btn {
      display: none; background: linear-gradient(45deg, var(--accent-cyan), var(--accent-green));
      color: #02120b; border: none; font-size: 0.72rem; font-weight: 800;
      padding: 5px 12px; border-radius: 20px; cursor: pointer;
    }
    .badge {
      background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--accent-green); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem;
      font-weight: 700; text-transform: uppercase; display: flex; align-items: center; gap: 5px;
    }
    .live-dot {
      width: 7px; height: 7px; border-radius: 50%; background: var(--accent-green);
      box-shadow: 0 0 8px var(--accent-green); animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .card {
      background: var(--card-bg); backdrop-filter: blur(24px); border: 1px solid var(--card-border);
      border-radius: 24px; padding: 22px; box-shadow: 0 12px 36px rgba(0,0,0,0.4);
    }
    .section-title { font-family: 'Space Grotesk', sans-serif; font-size: 1.15rem; font-weight: 700; margin-bottom: 12px; }
    .input-group { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
    .input-label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; }
    .input-box {
      width: 100%; padding: 12px 14px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.5);
      color: #fff; font-size: 0.95rem; outline: none;
    }
    .input-box:focus { border-color: var(--accent-cyan); }
    .btn-main {
      width: 100%; padding: 14px; border-radius: 50px; border: none;
      background: linear-gradient(45deg, var(--accent-green), var(--accent-cyan));
      color: #02120b; font-weight: 800; cursor: pointer; margin-top: 16px;
      font-family: 'Space Grotesk', sans-serif; font-size: 1rem;
    }
    .btn-main:active { transform: scale(0.98); }
    .auth-toggle { display: flex; background: rgba(0,0,0,0.4); border-radius: 12px; padding: 4px; margin-bottom: 14px; }
    .auth-toggle button {
      flex: 1; padding: 8px; border: none; background: transparent; color: var(--text-muted);
      font-weight: 700; border-radius: 8px; cursor: pointer;
    }
    .auth-toggle button.active { background: rgba(255,255,255,0.1); color: #fff; }
    .ring-container { position: relative; width: 190px; height: 190px; margin: 10px auto; display: flex; align-items: center; justify-content: center; }
    .ring-svg { transform: rotate(-90deg); width: 190px; height: 190px; }
    .ring-bg { fill: none; stroke: rgba(255, 255, 255, 0.06); stroke-width: 12; }
    .ring-bar {
      fill: none; stroke: url(#cyanGreenGrad); stroke-width: 12; stroke-linecap: round;
      stroke-dasharray: 534; stroke-dashoffset: 534; transition: stroke-dashoffset 0.6s ease;
    }
    .ring-center-content { position: absolute; display: flex; flex-direction: column; align-items: center; }
    .steps-display { font-size: 2.5rem; font-weight: 800; font-family: 'Space Grotesk', sans-serif; line-height: 1; }
    .stats-trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 16px; }
    .stat-pill {
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px; padding: 12px 6px; display: flex; flex-direction: column; align-items: center;
    }
    .stat-pill .val { font-family: 'Space Grotesk'; font-weight: 700; font-size: 1.15rem; color: var(--accent-cyan); }
    .stat-pill .lbl { font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; margin-top: 2px; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .grid-4 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .metric-card { background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.06); border-radius: 18px; padding: 14px; }
    .meal-box {
      cursor: pointer; transition: all 0.25s ease; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px; padding: 14px; background: rgba(0,0,0,0.3);
    }
    .meal-box:hover { transform: translateY(-2px); border-color: var(--accent-cyan); background: rgba(6, 182, 212, 0.08); }
    .meal-box.active { border-color: var(--accent-green); background: rgba(16, 185, 129, 0.12); }
    .diet-toggle { display: flex; background: rgba(0,0,0,0.5); border-radius: 20px; padding: 3px; gap: 4px; margin-bottom: 14px; }
    .diet-btn {
      flex: 1; padding: 8px; border: none; background: transparent; color: var(--text-muted);
      font-size: 0.8rem; font-weight: 700; border-radius: 16px; cursor: pointer;
    }
    .diet-btn.active { background: var(--accent-green); color: #02120b; }
    .diet-btn.active.nonveg { background: var(--accent-orange); color: #fff; }
    .food-suggestion-card {
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
      border-radius: 16px; padding: 12px 14px; margin-top: 10px;
    }
    .progress-track { width: 100%; height: 7px; background: rgba(255,255,255,0.08); border-radius: 10px; overflow: hidden; margin: 8px 0; }
    .progress-fill { height: 100%; width: 0%; transition: width 0.4s ease; }
    .chip-btn {
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
      padding: 10px 14px; border-radius: 14px; font-size: 0.82rem; font-weight: 700;
      cursor: pointer; color: #fff; flex: 1; text-align: center;
    }
    .tip-item {
      display: flex; align-items: flex-start; gap: 12px; padding: 12px;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05);
      border-radius: 14px; margin-bottom: 8px; font-size: 0.85rem; line-height: 1.4;
    }
    .routine-row {
      display: flex; align-items: center; justify-content: space-between; padding: 12px 14px;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px; margin-top: 8px; font-size: 0.88rem; cursor: pointer;
    }
    .routine-row.done { text-decoration: line-through; opacity: 0.45; border-color: var(--accent-green); }
    .tab-bar {
      position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
      width: calc(100% - 24px); max-width: 600px; background: rgba(13, 17, 30, 0.94);
      backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 36px; padding: 6px 8px; display: flex; justify-content: space-around;
      z-index: 100;
    }
    .tab-btn {
      background: transparent; border: none; color: var(--text-muted); font-size: 0.70rem;
      font-weight: 700; padding: 8px 10px; border-radius: 20px; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 3px;
    }
    .tab-btn.active { color: #fff; background: rgba(255,255,255,0.1); }
    .tab-page { display: none; flex-direction: column; gap: 14px; }
    .tab-page.active { display: flex; }
  </style>
</head>
<body>
  <svg style="width:0; height:0; position:absolute;" aria-hidden="true" focusable="false">
    <linearGradient id="cyanGreenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981" /><stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>
  </svg>

  <div class="app-container">
    <div class="nav-bar">
      <div class="brand-logo">⚡ PulseFlow</div>
      <div class="nav-actions">
        <button id="pwaInstallBtn" class="pwa-btn" onclick="triggerPWAInstall()">📲 Install App</button>
        <a href="/api/export-excel" style="text-decoration:none; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.72rem; font-weight:700; padding:4px 10px; border-radius:20px;">📥 Excel</a>
        <div class="badge"><span class="live-dot"></span> Live</div>
      </div>
    </div>

    <!-- AUTHENTICATION FORM -->
    <div id="authCard" class="card">
      <div class="auth-toggle">
        <button id="tabBtnLogin" class="active" onclick="toggleAuthMode('login')">Log In</button>
        <button id="tabBtnRegister" onclick="toggleAuthMode('register')">Sign Up</button>
      </div>

      <form id="formLogin" onsubmit="handleLogin(event)">
        <div class="input-group"><label class="input-label">Email</label><input type="email" id="loginEmail" class="input-box" placeholder="e.g. user@domain.com" required /></div>
        <div class="input-group"><label class="input-label">Password</label><input type="password" id="loginPassword" class="input-box" placeholder="••••••••" required /></div>
        <button type="submit" class="btn-main">Log In</button>
      </form>

      <form id="formRegister" style="display: none;" onsubmit="handleRegister(event)">
        <div class="input-group"><label class="input-label">Full Name</label><input type="text" id="regName" class="input-box" placeholder="e.g. Alex" required /></div>
        <div class="input-group"><label class="input-label">Email</label><input type="email" id="regEmail" class="input-box" placeholder="e.g. user@domain.com" required /></div>
        <div class="input-group"><label class="input-label">Password</label><input type="password" id="regPassword" class="input-box" placeholder="Create password" required /></div>
        <div style="display: flex; gap: 10px;">
          <div class="input-group" style="flex:1;"><label class="input-label">Age</label><input type="number" id="regAge" class="input-box" placeholder="e.g. 24" required /></div>
          <div class="input-group" style="flex:1;"><label class="input-label">Gender</label><select id="regGender" class="input-box"><option value="male">Male</option><option value="female">Female</option></select></div>
        </div>
        <div style="display: flex; gap: 10px;">
          <div class="input-group" style="flex:1;"><label class="input-label">Weight (kg)</label><input type="number" id="regWeight" class="input-box" placeholder="e.g. 70" step="0.1" required /></div>
          <div class="input-group" style="flex:1;"><label class="input-label">Height (cm)</label><input type="number" id="regHeight" class="input-box" placeholder="e.g. 175" required /></div>
        </div>
        <button type="submit" class="btn-main">Sign Up</button>
      </form>
    </div>

    <!-- TAB 1: ACTIVITY -->
    <div id="tab-activity" class="tab-page">
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h2 id="userName" style="font-family: 'Space Grotesk'; font-size: 1.4rem;">Hi</h2>
            <span id="userPlanCategory" style="color: var(--accent-cyan); font-size: 0.8rem; font-weight: 700; text-transform: uppercase;">--</span>
          </div>
          <button style="background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--accent-rose); padding: 4px 10px; border-radius: 12px; font-size: 0.72rem; cursor: pointer;" onclick="logout()">Log Out</button>
        </div>

        <div style="text-align: center; margin-top: 14px;">
          <div class="ring-container">
            <svg class="ring-svg"><circle class="ring-bg" cx="95" cy="95" r="85" /><circle id="stepRingCircle" class="ring-bar" cx="95" cy="95" r="85" /></svg>
            <div class="ring-center-content"><span style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Steps</span><div class="steps-display" id="stepsVal">0</div><span id="stepsPctVal" style="font-size: 0.75rem; color: var(--accent-cyan); font-weight: 700;">0%</span></div>
          </div>
          <div id="targetSteps" style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">Target: 10,000 steps</div>
          <div class="stats-trio">
            <div class="stat-pill"><span class="val" id="dispDist">0.00</span><span class="lbl">Distance (km)</span></div>
            <div class="stat-pill"><span class="val" id="dispBurn" style="color: var(--accent-orange);">0</span><span class="lbl">Burned (kcal)</span></div>
            <div class="stat-pill"><span class="val" id="dispActiveMin" style="color: var(--accent-purple);">0</span><span class="lbl">Active Mins</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <span class="section-title" style="margin-bottom: 0;">💧 Hydration</span>
          <b id="waterValQuick" style="color: var(--accent-cyan); font-family: 'Space Grotesk';">0.0L / --L</b>
        </div>
        <div class="progress-track" style="margin: 10px 0;"><div id="waterBarQuick" class="progress-fill" style="background: var(--accent-cyan);"></div></div>
        <div style="display: flex; gap: 8px;"><button class="chip-btn" onclick="addWater(0.25)">+250ml 💧</button><button class="chip-btn" onclick="addWater(0.50)">+500ml 🌊</button></div>
      </div>
    </div>

    <!-- TAB 2: NUTRITION & MEAL SUGGESTIONS -->
    <div id="tab-nutrition" class="tab-page">
      <div class="card">
        <div class="section-title">🥗 Daily Energy Blueprint</div>
        <div style="display: flex; justify-content: space-between; align-items: baseline;"><span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Maintenance (TDEE)</span><b id="dispTDEE" style="font-family: 'Space Grotesk'; font-size: 1.1rem; color: var(--text-muted);">-- kcal</b></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px;"><span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Prescribed Target</span><b id="dispCalories" style="font-family: 'Space Grotesk'; font-size: 1.6rem; color: var(--accent-orange);">-- kcal</b></div>
        <div class="grid-3" style="margin-top: 16px;">
          <div class="metric-card" style="text-align: center;"><span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700;">PROTEIN</span><div id="macroProtein" style="font-family:'Space Grotesk'; font-weight:700; color:var(--accent-rose); font-size:1.2rem; margin-top:2px;">--g</div></div>
          <div class="metric-card" style="text-align: center;"><span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700;">CARBS</span><div id="macroCarbs" style="font-family:'Space Grotesk'; font-weight:700; color:var(--accent-cyan); font-size:1.2rem; margin-top:2px;">--g</div></div>
          <div class="metric-card" style="text-align: center;"><span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700;">FATS</span><div id="macroFats" style="font-family:'Space Grotesk'; font-weight:700; color:var(--accent-green); font-size:1.2rem; margin-top:2px;">--g</div></div>
        </div>
      </div>

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="section-title" style="margin-bottom: 0;">🍽️ Smart Meal Explorer</div>
        </div>
        <p style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 12px;">Click on any meal slot below to see recommended food combinations tailored to your daily target:</p>
        
        <!-- Veg / Non-Veg Switcher -->
        <div class="diet-toggle">
          <button id="dietBtnVeg" class="diet-btn active" onclick="setDietPreference('veg')">🥦 Vegetarian Options</button>
          <button id="dietBtnNonVeg" class="diet-btn" onclick="setDietPreference('nonveg')">🍗 Non-Vegetarian Options</button>
        </div>

        <div class="grid-4" id="mealsContainer"></div>

        <!-- Selected Meal Deep Dive Panel -->
        <div id="selectedMealPanel" style="margin-top: 18px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <b id="selectedMealTitle" style="font-family: 'Space Grotesk'; font-size: 1.1rem; color: var(--accent-cyan);">Breakfast Breakdown</b>
            <span id="selectedMealCalorieTag" style="font-size: 0.8rem; color: var(--accent-orange); font-weight: 700;">Target: -- kcal</span>
          </div>
          <div id="foodSuggestionsContainer"></div>
        </div>
      </div>
    </div>

    <!-- TAB 3: WORKOUTS -->
    <div id="tab-workouts" class="tab-page">
      <div class="card"><div class="section-title">🏋️ Prescribed Training Split</div><div id="workoutList"></div></div>
    </div>

    <!-- TAB 4: BIO HEALTH -->
    <div id="tab-health" class="tab-page">
      <div class="card">
        <div class="section-title">🧬 Biometric Diagnostics</div>
        <div class="grid-2">
          <div class="metric-card"><span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">Current BMI</span><div id="bioBMI" style="font-family:'Space Grotesk'; font-size: 1.4rem; font-weight: 700; color: var(--accent-cyan); margin-top: 2px;">--</div></div>
          <div class="metric-card"><span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">Ideal Weight Range</span><div id="bioIdealWeight" style="font-family:'Space Grotesk'; font-size: 1.2rem; font-weight: 700; color: var(--accent-green); margin-top: 2px;">-- kg</div></div>
        </div>
      </div>
      <div class="card"><div class="section-title">🎯 Targeted Body Protocols</div><div id="customTipsContainer"></div></div>
    </div>

    <!-- TAB 5: EDIT PROFILE -->
    <div id="tab-profile" class="tab-page">
      <div class="card">
        <div class="section-title">👤 Manage Profile & Biometrics</div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">Update your metrics below. PulseFlow will immediately adjust your calorie goals, macros, hydration targets, and BMI.</p>
        
        <form id="formEditProfile" onsubmit="handleUpdateProfile(event)">
          <div class="input-group">
            <label class="input-label">Full Name</label>
            <input type="text" id="editName" class="input-box" required />
          </div>
          <div class="input-group">
            <label class="input-label">Email (Read Only)</label>
            <input type="email" id="editEmail" class="input-box" disabled style="opacity: 0.6;" />
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="input-group" style="flex:1;">
              <label class="input-label">Age</label>
              <input type="number" id="editAge" class="input-box" required />
            </div>
            <div class="input-group" style="flex:1;">
              <label class="input-label">Gender</label>
              <select id="editGender" class="input-box">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="input-group" style="flex:1;">
              <label class="input-label">Weight (kg)</label>
              <input type="number" id="editWeight" class="input-box" step="0.1" required />
            </div>
            <div class="input-group" style="flex:1;">
              <label class="input-label">Height (cm)</label>
              <input type="number" id="editHeight" class="input-box" required />
            </div>
          </div>
          <button type="submit" class="btn-main">Update Profile ✨</button>
        </form>
      </div>
    </div>

    <!-- BOTTOM TAB NAVIGATION -->
    <div id="bottomTabBar" class="tab-bar" style="display: none;">
      <button class="tab-btn active" onclick="switchTab('activity')"><span>⚡</span> Activity</button>
      <button class="tab-btn" onclick="switchTab('nutrition')"><span>🥗</span> Nutrition</button>
      <button class="tab-btn" onclick="switchTab('workouts')"><span>🏋️</span> Workouts</button>
      <button class="tab-btn" onclick="switchTab('health')"><span>🧬</span> Bio Health</button>
      <button class="tab-btn" onclick="switchTab('profile')"><span>👤</span> Profile</button>
    </div>
  </div>

  <script>
    let deferredPrompt;
    const installBtn = document.getElementById('pwaInstallBtn');

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW skipped:', err));
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) installBtn.style.display = 'inline-block';
    });

    function triggerPWAInstall() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          installBtn.style.display = 'none';
        }
        deferredPrompt = null;
      });
    }

    let currentUser = JSON.parse(localStorage.getItem('pulseflow_session')) || null;
    let currentDietMode = 'veg';
    let selectedMealIndex = 0;
    let isTrackingActive = false, gravity = 9.8, alpha = 0.85, dynThreshold = 0.55, lastStepTime = 0, isPeakRising = false, lastFilteredVal = 0;
    const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 85;

    const FOOD_DATABASE = {
      breakfast: {
        veg: [
          { name: "Oats with Peanut Butter & Almond Milk", cal: 380, p: "18g", c: "48g", f: "14g", desc: "Rolled oats (50g) + 1 tbsp natural peanut butter + chia seeds." },
          { name: "Paneer Stuffed Besan Chilla (2x)", cal: 420, p: "22g", c: "35g", f: "16g", desc: "Chickpea flour crepes filled with grated low-fat paneer & mint chutney." },
          { name: "Moong Dal Sprouts & Vegetable Poha", cal: 340, p: "14g", c: "52g", f: "6g", desc: "Steamed sprouts with flattened rice, peanuts, curry leaves, and lemon." }
        ],
        nonveg: [
          { name: "3 Whole Eggs Scramble + Whole Wheat Toast", cal: 390, p: "24g", c: "32g", f: "16g", desc: "3 eggs scrambled with spinach & tomatoes + 2 slices brown bread." },
          { name: "Egg Bhurji (3 Eggs) + 2 Phulkas", cal: 410, p: "26g", c: "38g", f: "15g", desc: "Spiced Indian style scrambled eggs with onions and hot rotis." },
          { name: "Boiled Eggs (4 Whites + 2 Whole) + Oatmeal", cal: 430, p: "30g", c: "44g", f: "12g", desc: "Clean lean protein paired with slow-digesting oats." }
        ]
      },
      lunch: {
        veg: [
          { name: "Paneer Curry (150g) + 2 Rotis + Dal Bowl", cal: 560, p: "28g", c: "62g", f: "18g", desc: "Fresh cottage cheese cooked in light tomato gravy with tadka dal & cucumber salad." },
          { name: "Rajma (Kidney Beans) / Chole + Brown Rice", cal: 520, p: "20g", c: "78g", f: "9g", desc: "Pressure cooked legumes rich in fiber with a generous bowl of brown rice." },
          { name: "Soya Chunks Curry + Curd (Dahi) + 2 Rotis", cal: 490, p: "36g", c: "55g", f: "8g", desc: "High biological value vegetarian protein with cooling curd." }
        ],
        nonveg: [
          { name: "Grilled Chicken Breast (180g) + Brown Rice + Salad", cal: 540, p: "45g", c: "52g", f: "10g", desc: "Tender marinated chicken breast with steamed rice and mixed bell peppers." },
          { name: "Home-style Chicken Curry + 2 Phulkas + Curd", cal: 560, p: "40g", c: "48g", f: "16g", desc: "Light masala chicken curry paired with whole wheat flatbreads." },
          { name: "Fish Tikka / Curry (200g) + Steamed Rice", cal: 480, p: "38g", c: "50g", f: "9g", desc: "Omega-3 rich fish fillet cooked with mild spices and herbs." }
        ]
      },
      snack: {
        veg: [
          { name: "Roasted Makhana (Foxnuts) + Handful of Almonds", cal: 220, p: "7g", c: "24g", f: "11g", desc: "Crunchy low-calorie superfood tossed in pink salt and ghee." },
          { name: "Greek Yogurt / Thick Curd + Fresh Berries", cal: 180, p: "15g", c: "18g", f: "3g", desc: "High-protein dairy bowl for steady sustained energy." },
          { name: "Boiled Chana (Chickpeas) Chaat", cal: 230, p: "11g", c: "34g", f: "4g", desc: "Black chickpeas with diced onion, tomato, green chilli, and chaat masala." }
        ],
        nonveg: [
          { name: "3 Boiled Egg Whites + Black Coffee / Green Tea", cal: 110, p: "13g", c: "2g", f: "1g", desc: "Ultra-clean pure protein boost between workouts or work." },
          { name: "Chicken Tikka (4 Skewered Cubes, ~100g)", cal: 210, p: "26g", c: "4g", f: "7g", desc: "Tandoori baked boneless chicken cubes with lemon juice." },
          { name: "Egg White Sandwich (2 Slices Brown Bread)", cal: 240, p: "16g", c: "28g", f: "4g", desc: "Toasted sandwich with egg whites, cucumber, and pepper." }
        ]
      },
      dinner: {
        veg: [
          { name: "Tofu / Paneer Stir Fry with Broccoli & Peppers", cal: 420, p: "26g", c: "22g", f: "18g", desc: "Light dinner loaded with micronutrients and easily digestible protein." },
          { name: "Yellow Dal Tadka Bowl + 1 Roti + Lauki Sabzi", cal: 380, p: "18g", c: "54g", f: "8g", desc: "Light on stomach, promotes restful deep sleep without bloating." },
          { name: "Mixed Vegetable Khichdi + Glass of Buttermilk (Chaas)", cal: 410, p: "15g", c: "64g", f: "7g", desc: "Comforting Ayurvedic rice and lentil pot dish." }
        ],
        nonveg: [
          { name: "Egg Curry (2 Eggs) + 1 Multigrain Roti + Green Salad", cal: 390, p: "22g", c: "34g", f: "14g", desc: "Balanced evening meal with high bioavailability." },
          { name: "Grilled Chicken Salad with Olive Oil Dressing", cal: 420, p: "38g", c: "12g", f: "16g", desc: "Low carb, high-protein keto-friendly dinner split." },
          { name: "Clear Chicken Soup with Steamed Veggies + 1 Toast", cal: 330, p: "28g", c: "24g", f: "6g", desc: "Warm soothing broth rich in amino acids and electrolytes." }
        ]
      }
    };

    function toggleAuthMode(mode) {
      document.getElementById('tabBtnLogin').classList.toggle('active', mode === 'login');
      document.getElementById('tabBtnRegister').classList.toggle('active', mode === 'register');
      document.getElementById('formLogin').style.display = mode === 'login' ? 'block' : 'none';
      document.getElementById('formRegister').style.display = mode === 'register' ? 'block' : 'none';
    }

    function switchTab(tabId) {
      document.querySelectorAll('.tab-page').forEach(page => page.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      const targetPage = document.getElementById('tab-' + tabId);
      if (targetPage) targetPage.classList.add('active');
      const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
      if (activeBtn) activeBtn.classList.add('active');
    }

    function computePlan(weight, height, age, gender) {
      const hM = height / 100;
      const bmi = parseFloat((weight / (hM * hM)).toFixed(1));
      const offset = gender === 'female' ? -161 : 5;
      const bmr = Math.round(10 * weight + 6.25 * height - 5 * age + offset);
      const tdee = Math.round(bmr * 1.375);
      const minIdealWeight = (18.5 * hM * hM).toFixed(1);
      const maxIdealWeight = (24.9 * hM * hM).toFixed(1);

      let category = 'Normal Weight', targetSteps = 9000, targetWater = 2.8, targetCalories = tdee;
      let proteinG = Math.round(weight * 1.8), fatG = Math.round((tdee * 0.25) / 9);
      let carbG = Math.round((tdee - (proteinG * 4 + fatG * 9)) / 4);
      let tips = [], workouts = [];

      if (bmi >= 25) {
        category = 'Fat Loss & Recomposition'; targetSteps = 10500; targetWater = 3.4;
        targetCalories = Math.max(1300, tdee - 450); proteinG = Math.round(weight * 2.0);
        fatG = Math.round((targetCalories * 0.25) / 9);
        carbG = Math.round((targetCalories - (proteinG * 4 + fatG * 9)) / 4);
        tips = [{ icon: '🥗', title: 'Protein & Fiber Density', text: 'Prioritize lean proteins and fibrous vegetables for satiety during caloric deficit.' }, { icon: '🚶‍♂️', title: 'Daily Step Volume', text: 'Hit at least 10,000 steps daily to elevate basal energy expenditure.' }];
        workouts = ['35 Min Incline Walk', '3 Sets x 12 Bodyweight Squats', '3 Sets x 10 Push-ups', '3 Sets x 40s Plank'];
      } else if (bmi < 18.5) {
        category = 'Lean Mass Growth'; targetSteps = 7000; targetWater = 2.5; targetCalories = tdee + 350;
        tips = [{ icon: '🥜', title: 'Caloric Density', text: 'Eat nuts, seeds, oats, and whole milk for surplus calories.' }, { icon: '🏋️', title: 'Compound Strength', text: 'Focus on progressive resistance training (squats, bench, deadlifts).' }];
        workouts = ['3 Sets x 8 Dumbbell Press', '3 Sets x 8 Rows', '3 Sets x 10 Romanian Deadlifts'];
      } else {
        category = 'Lean Maintenance'; targetSteps = 8500; targetWater = 3.0; targetCalories = tdee;
        tips = [{ icon: '⚡', title: '80/20 Balance', text: '80% unprocessed whole foods with balanced nutrient profiles.' }, { icon: '🫀', title: 'Zone 2 Cardio', text: 'Perform 30 mins of conversational-pace exercise 3x weekly.' }];
        workouts = ['20 Min Brisk Jog', '3 Sets x 12 Shoulder Press', '3 Sets x 15 Walking Lunges'];
      }

      const meals = [
        { key: 'breakfast', name: 'Breakfast', cal: Math.round(targetCalories * 0.25), icon: '🍳' },
        { key: 'lunch', name: 'Lunch', cal: Math.round(targetCalories * 0.35), icon: '🥗' },
        { key: 'snack', name: 'Snack', cal: Math.round(targetCalories * 0.15), icon: '🍎' },
        { key: 'dinner', name: 'Dinner', cal: Math.round(targetCalories * 0.25), icon: '🍲' }
      ];

      return { bmi, category, tdee, targetSteps, targetWater, targetCalories, minIdealWeight, maxIdealWeight, proteinG, carbG, fatG, tips, workouts, meals };
    }

    function setDietPreference(mode) {
      currentDietMode = mode;
      const btnVeg = document.getElementById('dietBtnVeg');
      const btnNonVeg = document.getElementById('dietBtnNonVeg');
      
      btnVeg.classList.toggle('active', mode === 'veg');
      btnNonVeg.classList.toggle('active', mode === 'nonveg');
      btnNonVeg.classList.toggle('nonveg', mode === 'nonveg');

      renderSelectedMealBreakdown();
    }

    function selectMealSlot(index) {
      selectedMealIndex = index;
      renderMealBoxes();
      renderSelectedMealBreakdown();
    }

    function renderMealBoxes() {
      const mealsContainer = document.getElementById('mealsContainer');
      mealsContainer.innerHTML = '';
      currentUser.plan.meals.forEach((m, idx) => {
        const isActive = idx === selectedMealIndex;
        mealsContainer.innerHTML += \`
          <div class="meal-box \${isActive ? 'active' : ''}" onclick="selectMealSlot(\${idx})">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size: 1.3rem;">\${m.icon}</span>
              \${isActive ? '<span style="font-size:0.65rem; background:var(--accent-green); color:#000; font-weight:800; padding:2px 6px; border-radius:10px;">SELECTED</span>' : ''}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight:700; margin-top:6px;">\${m.name.toUpperCase()}</div>
            <div style="font-family:'Space Grotesk'; font-weight:700; color:var(--accent-orange); font-size:1.1rem;">\${m.cal} kcal</div>
          </div>
        \`;
      });
    }

    function renderSelectedMealBreakdown() {
      const meal = currentUser.plan.meals[selectedMealIndex];
      if (!meal) return;

      document.getElementById('selectedMealTitle').innerText = meal.icon + ' ' + meal.name + ' Recommendations (' + (currentDietMode === 'veg' ? 'Veg 🥦' : 'Non-Veg 🍗') + ')';
      document.getElementById('selectedMealCalorieTag').innerText = 'Target: ~' + meal.cal + ' kcal';

      const foodItems = (FOOD_DATABASE[meal.key] && FOOD_DATABASE[meal.key][currentDietMode]) || [];
      const foodContainer = document.getElementById('foodSuggestionsContainer');
      foodContainer.innerHTML = '';

      foodItems.forEach((food) => {
        foodContainer.innerHTML += \`
          <div class="food-suggestion-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <b style="font-size:0.92rem; color:#fff; font-family:'Space Grotesk';">\${food.name}</b>
              <span style="font-family:'Space Grotesk'; color:var(--accent-orange); font-weight:700; font-size:0.9rem;">\${food.cal} kcal</span>
            </div>
            <p style="font-size:0.78rem; color:var(--text-muted); margin:4px 0 8px;">\${food.desc}</p>
            <div style="display:flex; gap:8px;">
              <span style="font-size:0.7rem; background:rgba(244,63,94,0.15); color:var(--accent-rose); padding:2px 8px; border-radius:6px; font-weight:700;">Protein: \${food.p}</span>
              <span style="font-size:0.7rem; background:rgba(6,182,212,0.15); color:var(--accent-cyan); padding:2px 8px; border-radius:6px; font-weight:700;">Carbs: \${food.c}</span>
              <span style="font-size:0.7rem; background:rgba(16,185,129,0.15); color:var(--accent-green); padding:2px 8px; border-radius:6px; font-weight:700;">Fats: \${food.f}</span>
            </div>
          </div>
        \`;
      });
    }

    async function handleRegister(e) {
      e.preventDefault();
      const payload = {
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value,
        age: Number(document.getElementById('regAge').value),
        gender: document.getElementById('regGender').value,
        weight: Number(document.getElementById('regWeight').value),
        height: Number(document.getElementById('regHeight').value)
      };

      try {
        const res = await fetch('/api/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Account created successfully!');
        handleLoginDirect(payload.email, payload.password);
      } catch (err) { alert(err.message); }
    }

    async function handleLogin(e) {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      handleLoginDirect(email, password);
    }

    async function handleLoginDirect(email, password) {
      try {
        const res = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentUser = data.user;
        currentUser.plan = computePlan(currentUser.weight, currentUser.height, currentUser.age, currentUser.gender);
        localStorage.setItem('pulseflow_session', JSON.stringify(currentUser));
        loadDashboard();
        initAutoSensors();
      } catch (err) { alert(err.message); }
    }

    async function handleUpdateProfile(e) {
      e.preventDefault();
      const updatedName = document.getElementById('editName').value;
      const updatedAge = Number(document.getElementById('editAge').value);
      const updatedGender = document.getElementById('editGender').value;
      const updatedWeight = Number(document.getElementById('editWeight').value);
      const updatedHeight = Number(document.getElementById('editHeight').value);

      try {
        const res = await fetch('/api/update-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentUser.id,
            name: updatedName,
            age: updatedAge,
            gender: updatedGender,
            weight: updatedWeight,
            height: updatedHeight
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentUser.name = updatedName;
        currentUser.age = updatedAge;
        currentUser.gender = updatedGender;
        currentUser.weight = updatedWeight;
        currentUser.height = updatedHeight;
        currentUser.plan = computePlan(currentUser.weight, currentUser.height, currentUser.age, currentUser.gender);

        localStorage.setItem('pulseflow_session', JSON.stringify(currentUser));
        loadDashboard();
        alert('Profile updated and metrics recalculated!');
      } catch (err) {
        alert(err.message);
      }
    }

    function loadDashboard() {
      if (!currentUser) return;
      document.getElementById('authCard').style.display = 'none';
      document.getElementById('bottomTabBar').style.display = 'flex';
      switchTab('activity');

      document.getElementById('userName').innerText = 'Hi, ' + currentUser.name + ' 👋';
      document.getElementById('userPlanCategory').innerText = currentUser.plan.category + ' (BMI ' + currentUser.plan.bmi + ')';
      document.getElementById('targetSteps').innerText = 'Target: ' + currentUser.plan.targetSteps.toLocaleString() + ' steps';
      document.getElementById('dispTDEE').innerText = currentUser.plan.tdee + ' kcal';
      document.getElementById('dispCalories').innerText = currentUser.plan.targetCalories + ' kcal';
      document.getElementById('macroProtein').innerText = currentUser.plan.proteinG + 'g';
      document.getElementById('macroCarbs').innerText = currentUser.plan.carbG + 'g';
      document.getElementById('macroFats').innerText = currentUser.plan.fatG + 'g';

      renderMealBoxes();
      renderSelectedMealBreakdown();

      document.getElementById('bioBMI').innerText = currentUser.plan.bmi;
      document.getElementById('bioIdealWeight').innerText = currentUser.plan.minIdealWeight + ' - ' + currentUser.plan.maxIdealWeight + ' kg';

      const tipContainer = document.getElementById('customTipsContainer');
      tipContainer.innerHTML = '';
      currentUser.plan.tips.forEach(t => {
        tipContainer.innerHTML += \`
          <div class="tip-item"><span style="font-size:1.2rem;">\${t.icon}</span><div><b style="color: #fff;">\${t.title}</b><div style="color: var(--text-muted); font-size: 0.8rem;">\${t.text}</div></div></div>
        \`;
      });

      const workoutContainer = document.getElementById('workoutList');
      workoutContainer.innerHTML = '';
      currentUser.plan.workouts.forEach((w, idx) => {
        const isDone = currentUser.completedWorkouts && currentUser.completedWorkouts.includes(idx);
        workoutContainer.innerHTML += \`
          <div class="routine-row \${isDone ? 'done' : ''}" onclick="toggleWorkout(\${idx})">
            <span>\${w}</span><span>\${isDone ? '✅' : '⚪'}</span>
          </div>
        \`;
      });

      document.getElementById('editName').value = currentUser.name;
      document.getElementById('editEmail').value = currentUser.email;
      document.getElementById('editAge').value = currentUser.age;
      document.getElementById('editGender').value = currentUser.gender || 'male';
      document.getElementById('editWeight').value = currentUser.weight;
      document.getElementById('editHeight').value = currentUser.height;

      renderUI();
    }

    function renderUI() {
      document.getElementById('stepsVal').innerText = currentUser.steps.toLocaleString();
      document.getElementById('dispDist').innerText = (currentUser.steps * 0.00075).toFixed(2);
      document.getElementById('dispBurn').innerText = Math.round(currentUser.steps * 0.04);
      document.getElementById('dispActiveMin').innerText = Math.round(currentUser.steps / 100);

      const stepsPct = Math.min(100, Math.round((currentUser.steps / currentUser.plan.targetSteps) * 100));
      document.getElementById('stepsPctVal').innerText = stepsPct + '%';
      const offset = CIRCLE_CIRCUMFERENCE - (stepsPct / 100) * CIRCLE_CIRCUMFERENCE;
      document.getElementById('stepRingCircle').style.strokeDashoffset = offset;

      document.getElementById('waterValQuick').innerText = currentUser.water.toFixed(2) + 'L / ' + currentUser.plan.targetWater + 'L';
      const waterPct = Math.min(100, Math.round((currentUser.water / currentUser.plan.targetWater) * 100));
      document.getElementById('waterBarQuick').style.width = waterPct + '%';
    }

    async function syncBackend() {
      if (!currentUser || !currentUser.id) return;
      localStorage.setItem('pulseflow_session', JSON.stringify(currentUser));
      try {
        await fetch('/api/sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentUser.id, steps: currentUser.steps, water: currentUser.water, completedWorkouts: currentUser.completedWorkouts
          })
        });
      } catch (err) { console.error('Database sync error:', err); }
    }

    function addWater(amt) {
      currentUser.water = Math.round((currentUser.water + amt) * 100) / 100;
      renderUI();
      syncBackend();
    }

    function toggleWorkout(idx) {
      if (!currentUser.completedWorkouts) currentUser.completedWorkouts = [];
      if (currentUser.completedWorkouts.includes(idx)) currentUser.completedWorkouts = currentUser.completedWorkouts.filter(i => i !== idx);
      else currentUser.completedWorkouts.push(idx);
      loadDashboard();
      syncBackend();
    }

    function logout() { localStorage.removeItem('pulseflow_session'); location.reload(); }

    async function initAutoSensors() {
      if (isTrackingActive) return;
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try { await DeviceMotionEvent.requestPermission(); } catch (e) {}
      }
      window.addEventListener('devicemotion', handleMotion, false);
      isTrackingActive = true;
    }

    function handleMotion(e) {
      if (!currentUser) return;
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc) return;
      const rawMag = Math.sqrt((acc.x || 0)**2 + (acc.y || 0)**2 + (acc.z || 0)**2);
      gravity = alpha * gravity + (1 - alpha) * rawMag;
      const linearAccel = Math.abs(rawMag - gravity);
      const now = Date.now();

      if (linearAccel > dynThreshold && linearAccel > lastFilteredVal) isPeakRising = true;
      if (isPeakRising && linearAccel < lastFilteredVal && (now - lastStepTime > 250) && (now - lastStepTime < 1800)) {
        currentUser.steps++;
        lastStepTime = now;
        isPeakRising = false;
        renderUI();
        syncBackend();
      } else if (now - lastStepTime >= 1800) {
        lastStepTime = now;
        isPeakRising = false;
      }
      lastFilteredVal = linearAccel;
    }

    if (currentUser) {
      currentUser.plan = computePlan(currentUser.weight, currentUser.height, currentUser.age, currentUser.gender);
      loadDashboard();
      initAutoSensors();
    }
  </script>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 PulseFlow Full-Stack Server active on http://localhost:${PORT}`);
});
