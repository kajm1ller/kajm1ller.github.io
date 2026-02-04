const https = require('https');
const fs = require('fs');
const express = require('express');

const app = express();
app.use(express.json());
app.use(express.static('.'));

// Spotify API Configuration
const SPOTIFY_CLIENT_ID = 'bfe4489b510f416da87c51d4661682ba'; // You'll need to add your client ID
const SPOTIFY_CLIENT_SECRET = '2f968d8555c6413293e8910ee73f0550';

// Determine if production or local
const isProductionEnv = fs.existsSync('/etc/letsencrypt/live/kaj.services/privkey.pem');
const SPOTIFY_REDIRECT_URI = isProductionEnv 
  ? 'https://kaj.services/api/spotify/callback'
  : 'http://localhost:3000/api/spotify/callback';

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

// Check if running on production (has SSL certs) or locally
const isProduction = fs.existsSync('/etc/letsencrypt/live/kaj.services/privkey.pem');

if (isProduction) {
  const options = {
    key: fs.readFileSync('/etc/letsencrypt/live/kaj.services/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/kaj.services/fullchain.pem')
  };

  https.createServer(options, app).listen(443, '0.0.0.0', () => {
    console.log('HTTPS Server running on port 443');
  });
} else {
  // Local development - use HTTP
  const http = require('http');
  const PORT = 3000;
  
  http.createServer(app).listen(PORT, () => {
    console.log(`Development server running on http://localhost:${PORT}`);
    console.log(`Visit http://localhost:${PORT}/api/spotify/login to authenticate`);
  });
}
