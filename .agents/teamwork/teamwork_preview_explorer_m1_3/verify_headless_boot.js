import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../');

const server = http.createServer((req, res) => {
    let filePath = path.join(rootDir, req.url === '/' ? 'game.html' : req.url.split('?')[0]);
    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    const ext = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.css': 'text/css',
        '.png': 'image/png'
    };
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
});

server.listen(3457, async () => {
    console.log('Test server listening on http://localhost:3457');
    
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browserPath = fs.existsSync(chromePath) ? chromePath : edgePath;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-test-'));
    
    console.log('Using browser:', browserPath);
    
    const browserProcess = spawn(browserPath, [
        '--headless=new',
        '--remote-debugging-port=9223',
        `--user-data-dir=${tempDir}`,
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        'http://localhost:3457/game.html'
    ]);
    
    // Give browser 2 seconds to start CDP
    await new Promise(r => setTimeout(r, 2000));
    
    try {
        const versionRes = await fetch('http://127.0.0.1:9223/json/list');
        const tabs = await versionRes.json();
        console.log('Browser tabs found:', tabs.length);
        const gameTab = tabs.find(t => t.url.includes('3457')) || tabs[0];
        if (gameTab) {
            console.log('Connected to tab:', gameTab.title, gameTab.url);
            
            // Connect to WebSocket CDP
            const WebSocket = (await import('ws')).default;
            const ws = new WebSocket(gameTab.webSocketDebuggerUrl);
            
            ws.on('open', () => {
                ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
                ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
            });
            
            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.method === 'Console.messageAdded') {
                    console.log('[BROWSER CONSOLE]', msg.params.message.level, msg.params.message.text);
                }
                if (msg.method === 'Runtime.exceptionThrown') {
                    console.log('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
                }
            });
            
            // Wait 4 seconds to gather console events
            await new Promise(r => setTimeout(r, 4000));
            ws.close();
        }
    } catch (err) {
        console.error('CDP communication error:', err);
    } finally {
        browserProcess.kill();
        server.close();
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
        console.log('Test finished.');
        process.exit(0);
    }
});
