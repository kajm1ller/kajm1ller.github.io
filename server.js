const https = require('https');
const fs = require('fs');
const express = require('express');

const app = express();

const options = {
  key: fs.readFileSync('/etc/letsencrypt/live/kaj.services/privkey.pem'),
  cert: fs.readFileSync('//etc/letsencrypt/live/kaj.services/fullchain.pem')
};

https.createServer(options, app).listen(443, '0.0.0.0', () => {
  console.log('HTTPS Server running on port 443');
});
