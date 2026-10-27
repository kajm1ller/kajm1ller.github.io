const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const googleTTS = require('google-tts-api');

const app = express();

const CERT_DIR = process.env.SSL_CERT_DIR || '/etc/letsencrypt/live/kaj.services';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(CERT_DIR, 'privkey.pem');
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(CERT_DIR, 'fullchain.pem');
const hasTlsCerts = fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH);
const isLocalDevelopment = !hasTlsCerts;
const staticOptions = isLocalDevelopment
  ? {
      etag: false,
      lastModified: false,
      setHeaders(res, filePath) {
        if (path.extname(filePath) === '.html') {
          res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.set('Pragma', 'no-cache');
          res.set('Expires', '0');
        }
      }
    }
  : undefined;

app.use(express.json());

// The map is ~1 GB of OBJ text. Serve it gzipped (compressed once, kept in .cache/) and let the browser
// keep it, so a first load downloads a fraction of it and a reload (e.g. applying graphics) downloads none.
const zlib = require('zlib');
const MAP_DIR = path.join(__dirname, 'mapfinal');
const GZ_DIR = path.join(__dirname, '.cache', 'mapfinal-gz');
const gzJobs = new Map();
function gzipped(name) {
  const src = path.join(MAP_DIR, name);
  const dst = path.join(GZ_DIR, name + '.gz');
  let job = gzJobs.get(name);
  if (!job) {
    job = (async () => {
      try {
        const [s, d] = [fs.statSync(src), fs.existsSync(dst) ? fs.statSync(dst) : null];
        if (d && d.mtimeMs >= s.mtimeMs) return dst;
      } catch (e) { return null; }
      fs.mkdirSync(GZ_DIR, { recursive: true });
      const tmp = dst + '.' + process.pid + '.tmp';
      await require('stream/promises').pipeline(fs.createReadStream(src), zlib.createGzip({ level: 5 }), fs.createWriteStream(tmp));
      fs.renameSync(tmp, dst);
      return dst;
    })().catch(() => null);
    gzJobs.set(name, job);
    job.then(() => gzJobs.delete(name));
  }
  return job;
}
app.get(/^\/mapfinal\/([\w.-]+\.obj)$/, async (req, res, next) => {
  if (!/gzip/.test(req.headers['accept-encoding'] || '')) return next();
  const file = await gzipped(req.params[0]);
  if (!file) return next();
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Cache-Control': 'public, max-age=86400' });
  res.sendFile(file, (err) => { if (err && !res.headersSent) next(); });
});
app.use('/mapfinal', (req, res, next) => { res.set('Cache-Control', 'public, max-age=86400'); next(); });

// Map editor (game.html?mapedit=1): rewrites the OBJ parts in mapfinal/. Only from this machine; the first
// edit of a part keeps the original in mapedit-backup/.
app.post('/api/mapedit', express.json({ limit: '20mb' }), async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) return res.status(403).json({ error: 'local only' });
  try {
    const { applyMapEdits, applyEntityEdits } = await import('./js/game/mapEditCore.js');
    const byPart = new Map();
    for (const op of req.body.ops || []) {
      if (!/^part\d{4}\.obj$/.test(op.part)) throw new Error('bad part ' + op.part);
      if (!byPart.has(op.part)) byPart.set(op.part, []);
      byPart.get(op.part).push(op);
    }
    // Compute everything first so a bad op leaves the map untouched
    const results = [];
    for (const [part, ops] of byPart) {
      const file = path.join(MAP_DIR, part);
      const before = fs.readFileSync(file, 'utf8');
      results.push({ part, file, before, after: applyMapEdits(before, ops) });
    }
    // Entities kept in data files (gas stations, street signs, moved road signs)
    const DATA_DIR = path.join(__dirname, 'js', 'game', 'data');
    const byFile = new Map();
    for (const op of req.body.entityOps || []) {
      if (!['gasStations', 'streetSigns', 'roadSignEdits'].includes(op.file)) throw new Error('bad file ' + op.file);
      if (!byFile.has(op.file)) byFile.set(op.file, []);
      byFile.get(op.file).push(op);
    }
    for (const [name, ops] of byFile) {
      const file = path.join(DATA_DIR, name + '.json');
      const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
      const after = JSON.stringify(applyEntityEdits(name, JSON.parse(before), ops), null, name === 'gasStations' ? 1 : name === 'roadSignEdits' ? 1 : 0);
      results.push({ part: name + '.json', file, before, after });
    }
    const backupDir = path.join(__dirname, 'mapedit-backup');
    fs.mkdirSync(backupDir, { recursive: true });
    for (const r of results) {
      const bak = path.join(backupDir, r.part);
      if (!fs.existsSync(bak)) fs.writeFileSync(bak, r.before);
      const tmp = r.file + '.tmp';
      fs.writeFileSync(tmp, r.after);
      fs.renameSync(tmp, r.file);
    }
    res.json({ ok: true, parts: results.map((r) => r.part).filter((p) => p.endsWith('.obj')) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.use(express.static(path.join(__dirname), staticOptions));

app.get('/api/bedroom-voice', async (req, res) => {
  const text = String(req.query.text || '').trim().slice(0, 200);

  if (!text) {
    return res.status(400).json({ error: 'Text required' });
  }

  try {
    const audioUrl = googleTTS.getAudioUrl(text, {
      lang: 'en',
      slow: false,
      host: 'https://translate.google.com'
    });

    const audioResponse = await fetch(audioUrl);

    if (!audioResponse.ok) {
      return res.status(502).json({ error: 'Failed to generate speech' });
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    res.setHeader('Content-Type', audioResponse.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(audioBuffer);
  } catch (error) {
    console.error('Bedroom voice error:', error);
    res.status(500).json({ error: 'Failed to speak' });
  }
});

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT, 10) || (hasTlsCerts ? 443 : 3000);
const PUBLIC_HOST = process.env.PUBLIC_HOST || (hasTlsCerts ? 'kaj.services' : 'localhost');
const PUBLIC_PORT = Number.parseInt(process.env.PUBLIC_PORT, 10) || PORT;
const PROTOCOL = hasTlsCerts ? 'https' : 'http';
const needsExplicitPort = !((PROTOCOL === 'http' && PUBLIC_PORT === 80) || (PROTOCOL === 'https' && PUBLIC_PORT === 443));
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || `${PROTOCOL}://${PUBLIC_HOST}${needsExplicitPort ? `:${PUBLIC_PORT}` : ''}`;

// Spotify API Configuration
const SPOTIFY_CLIENT_ID = 'bfe4489b510f416da87c51d4661682ba'; // You'll need to add your client ID
const SPOTIFY_CLIENT_SECRET = '2f968d8555c6413293e8910ee73f0550';

const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `${PUBLIC_ORIGIN}/api/spotify/callback`;

let spotifyAccessToken = null;
let spotifyRefreshToken = null;
let tokenExpiry = null;

// Store who added what to queue (in-memory, resets on server restart)
const queueAdditions = new Map();

// Spotify Auth - Step 1: Redirect to Spotify login
app.get('/api/spotify/login', (req, res) => {
  const scopes = [
    'user-read-playback-state',
    'user-read-currently-playing',
    'user-modify-playback-state'
  ].join(' ');
  
  const authUrl = `https://accounts.spotify.com/authorize?` +
    `response_type=code&client_id=${SPOTIFY_CLIENT_ID}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}`;
  
  res.redirect(authUrl);
});

// Spotify Auth - Step 2: Callback from Spotify
app.get('/api/spotify/callback', async (req, res) => {
  const code = req.query.code;
  
  if (!code) {
    return res.status(400).send('No code provided');
  }
  
  try {
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: SPOTIFY_REDIRECT_URI
      })
    });
    
    const tokens = await tokenResponse.json();
    
    if (tokens.access_token) {
      spotifyAccessToken = tokens.access_token;
      spotifyRefreshToken = tokens.refresh_token;
      tokenExpiry = Date.now() + (tokens.expires_in * 1000);
      
      res.redirect('/music.html?auth=success');
    } else {
      res.status(400).send('Failed to get tokens: ' + JSON.stringify(tokens));
    }
  } catch (error) {
    console.error('Spotify callback error:', error);
    res.status(500).send('Authentication error');
  }
});

// Refresh the access token
async function refreshAccessToken() {
  if (!spotifyRefreshToken) return false;
  
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: spotifyRefreshToken
      })
    });
    
    const tokens = await response.json();
    
    if (tokens.access_token) {
      spotifyAccessToken = tokens.access_token;
      tokenExpiry = Date.now() + (tokens.expires_in * 1000);
      return true;
    }
  } catch (error) {
    console.error('Token refresh error:', error);
  }
  return false;
}

// Middleware to ensure valid token
async function ensureToken(req, res, next) {
  if (!spotifyAccessToken) {
    return res.status(401).json({ error: 'Not authenticated', login_url: '/api/spotify/login' });
  }
  
  if (tokenExpiry && Date.now() >= tokenExpiry - 60000) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      return res.status(401).json({ error: 'Token expired', login_url: '/api/spotify/login' });
    }
  }
  
  next();
}

// Get currently playing track
app.get('/api/spotify/now-playing', ensureToken, async (req, res) => {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    if (response.status === 204) {
      return res.json({ is_playing: false });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Now playing error:', error);
    res.status(500).json({ error: 'Failed to get currently playing' });
  }
});

// Get queue
app.get('/api/spotify/queue', ensureToken, async (req, res) => {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/queue', {
      headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    });
    
    const data = await response.json();
    
    // Add "added_by" info to queue items
    if (data.queue) {
      data.queue = data.queue.map(track => ({
        ...track,
        added_by: queueAdditions.get(track.uri) || null
      }));
    }
    
    res.json(data);
  } catch (error) {
    console.error('Queue error:', error);
    res.status(500).json({ error: 'Failed to get queue' });
  }
});

// Search tracks
app.get('/api/spotify/search', ensureToken, async (req, res) => {
  const query = req.query.q;
  
  if (!query) {
    return res.status(400).json({ error: 'Query required' });
  }
  
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
      { headers: { 'Authorization': `Bearer ${spotifyAccessToken}` } }
    );
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Add to queue
app.post('/api/spotify/add-to-queue', ensureToken, async (req, res) => {
  const { uri, added_by } = req.body;
  
  if (!uri) {
    return res.status(400).json({ error: 'Track URI required' });
  }
  
  try {
    // Get track info for logging
    const trackId = uri.split(':').pop();
    const trackInfoRes = await fetch(
      `https://api.spotify.com/v1/tracks/${trackId}`,
      { headers: { 'Authorization': `Bearer ${spotifyAccessToken}` } }
    );
    const trackInfo = await trackInfoRes.json();
    const trackName = trackInfo.name || 'Unknown Track';
    const artistName = trackInfo.artists?.map(a => a.name).join(', ') || 'Unknown Artist';
    
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      }
    );
    
    if (response.ok || response.status === 204) {
      // Log the addition with timestamp
      const timestamp = new Date().toISOString();
      console.log(`[QUEUE ADD] ${timestamp} | "${trackName}" by ${artistName} | Added by: ${added_by || 'Anonymous'}`);
      
      // Store who added this track
      if (added_by) {
        queueAdditions.set(uri, added_by);
        // Clean up old entries after 1 hour
        setTimeout(() => queueAdditions.delete(uri), 3600000);
      }
      
      res.json({ success: true });
    } else {
      const error = await response.json();
      res.status(response.status).json({ error: error.error?.message || 'Failed to add to queue' });
    }
  } catch (error) {
    console.error('Add to queue error:', error);
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

// Check auth status
app.get('/api/spotify/status', (req, res) => {
  res.json({
    authenticated: !!spotifyAccessToken,
    login_url: '/api/spotify/login'
  });
});

// ============ MULTIPLAYER GAME SERVER ============
// Player sync, chat and PvP hits live in multiplayerServer.js
const { attachMultiplayer } = require('./multiplayerServer');

function createServer() {
  if (!hasTlsCerts) {
    return http.createServer(app);
  }

  return https.createServer({
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH)
  }, app);
}

const server = createServer();
attachMultiplayer(server, { log: console.log });

server.listen(PORT, HOST, () => {
  const wsProtocol = hasTlsCerts ? 'wss' : 'ws';
  console.log(`${PROTOCOL.toUpperCase()} server running on ${PUBLIC_ORIGIN}`);
  console.log(`WebSocket server running on ${wsProtocol}://${PUBLIC_HOST}${needsExplicitPort ? `:${PUBLIC_PORT}` : ''}`);
  console.log(`Listening on ${HOST}:${PORT}`);
  console.log(`Visit ${PUBLIC_ORIGIN}/api/spotify/login to authenticate`);

  // Compress the map parts in the background so the first player does not wait on it
  (async () => {
    let names = [];
    try { names = fs.readdirSync(MAP_DIR).filter((n) => n.endsWith('.obj')); } catch (e) { return; }
    const worker = async () => { while (names.length) await gzipped(names.pop()); };
    await Promise.all([worker(), worker(), worker()]);
    console.log('Map parts gzipped in .cache/mapfinal-gz');
  })();
});
