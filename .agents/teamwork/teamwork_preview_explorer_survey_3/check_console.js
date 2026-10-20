const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'ws'));

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;

async function run() {
  console.log('Launching Chrome...');
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ]);

  // Wait for Chrome debugging port to open
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

  if (!wsUrl) {
    console.error('Failed to get WebSocket debugger URL');
    chrome.kill();
    process.exit(1);
  }

  console.log('Connected to Chrome page target at:', wsUrl);
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const consoleMessages = [];
  const errors = [];

  ws.on('open', () => {
    ws.send(JSON.stringify({ id: id++, method: 'Console.enable' }));
    ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable' }));
    ws.send(JSON.stringify({ id: id++, method: 'Page.enable' }));

    const gameUrl = 'file:///' + path.resolve(__dirname, '..', '..', '..', 'game.html').replace(/\\/g, '/');
    console.log('Navigating to:', gameUrl);
    ws.send(JSON.stringify({ id: id++, method: 'Page.navigate', params: { url: gameUrl } }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      console.log(`[Browser Console ${msg.params.type}]`, msg.params.args.map(a => a.value || a.description).join(' '));
      consoleMessages.push(msg.params);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[Browser Exception]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
      errors.push(msg.params.exceptionDetails);
    }
  });

  // Let it run for 4 seconds
  await new Promise(r => setTimeout(r, 4000));

  console.log('Test completed. Total errors:', errors.length);
  ws.close();
  chrome.kill();
  process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
