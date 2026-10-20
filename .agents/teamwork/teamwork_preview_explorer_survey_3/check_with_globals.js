const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'ws'));

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;

async function run() {
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ]);

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const list = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/json/list`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {}
  }

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const consoleMessages = [];
  const errors = [];

  ws.on('open', () => {
    ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable' }));
    ws.send(JSON.stringify({ id: id++, method: 'Page.enable' }));

    // Inject fix before document starts loading
    ws.send(JSON.stringify({
      id: id++,
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          window.viewmodelScene = null;
          window.viewmodelCamera = null;
          window.viewmodelSprayCan = null;
          window.viewmodelBobTime = 0;
          window.sprayParticleTime = 0;
        `
      }
    }));

    const gameUrl = 'file:///' + path.resolve(__dirname, '..', '..', '..', 'game.html').replace(/\\/g, '/');
    ws.send(JSON.stringify({ id: id++, method: 'Page.navigate', params: { url: gameUrl } }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      console.log(`[Browser Console ${msg.params.type}]`, msg.params.args.map(a => a.value || a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[Browser Exception]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
      errors.push(msg.params.exceptionDetails);
    }
  });

  await new Promise(r => setTimeout(r, 4000));

  console.log('Test completed with injected globals. Total errors:', errors.length);
  ws.close();
  chrome.kill();
  process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
