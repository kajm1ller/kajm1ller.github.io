/**
 * Native Chrome DevTools Protocol (CDP) Test Runner & Harness
 * Supports Microsoft Edge and Google Chrome via native WebSocket ('ws')
 * Features:
 * - Zero external browser automation dependencies (pure native CDP over ws)
 * - Automatic browser discovery (Edge / Chrome / env BROWSER_PATH)
 * - Built-in zero-config static HTTP file server for CORS-free ES module loading
 * - Detailed capture of uncaught runtime exceptions and console logs
 * - Evaluation, function polling, and deterministic simulation stepping helpers
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Known browser binary locations on Windows
const DEFAULT_BROWSER_PATHS = {
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ]
};

// Common MIME types for local static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.obj': 'text/plain; charset=utf-8',
  '.mtl': 'text/plain; charset=utf-8',
  '.osm': 'application/xml; charset=utf-8'
};

/**
 * Find available browser executable
 * @param {'edge' | 'chrome' | 'auto'} preference
 * @returns {string} Executable path
 */
function findBrowserPath(preference = 'auto') {
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) {
    return process.env.BROWSER_PATH;
  }

  const searchOrder = [];
  if (preference === 'chrome') {
    searchOrder.push(...DEFAULT_BROWSER_PATHS.chrome, ...DEFAULT_BROWSER_PATHS.edge);
  } else if (preference === 'edge') {
    searchOrder.push(...DEFAULT_BROWSER_PATHS.edge, ...DEFAULT_BROWSER_PATHS.chrome);
  } else {
    // auto: prefer Edge on Windows or Chrome if Edge not found
    searchOrder.push(...DEFAULT_BROWSER_PATHS.edge, ...DEFAULT_BROWSER_PATHS.chrome);
  }

  for (const candidate of searchOrder) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `No supported browser executable found for preference '${preference}'. Please specify BROWSER_PATH environment variable.`
  );
}

/**
 * Get a free TCP port from the OS
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Start a lightweight static HTTP file server for serving workspace assets
 * @param {string} rootDir
 * @returns {Promise<{ server: http.Server, port: number, url: string, close: () => Promise<void> }>}
 */
function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(reqUrl.pathname);
      if (pathname === '/') pathname = '/game.html';

      const safePath = path.normalize(path.join(rootDir, pathname));
      if (!safePath.startsWith(path.normalize(rootDir))) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Access Denied');
        return;
      }

      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });

        fs.createReadStream(safePath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`File not found: ${pathname}`);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}`;
      resolve({
        server,
        port,
        url,
        close: () => new Promise(cb => server.close(cb))
      });
    });

    server.on('error', reject);
  });
}

/**
 * CDP Test Harness Class
 */
class CDPHarness {
  constructor(options = {}) {
    this.options = Object.assign(
      {
        browser: 'auto',
        headless: true,
        rootDir: path.resolve(__dirname, '..'),
        viewport: { width: 1280, height: 720 },
        timeout: 15000,
        verbose: false
      },
      options
    );

    this.browserProcess = null;
    this.tempUserDataDir = null;
    this.staticServer = null;
    this.ws = null;
    this.msgId = 0;
    this.pendingRequests = new Map();

    this.exceptions = [];
    this.consoleMessages = [];
    this.loadEventFired = false;
    this.isClosed = false;

    this._cleanupRegistered = false;
  }

  log(...args) {
    if (this.options.verbose) {
      console.log('[CDPHarness]', ...args);
    }
  }

  /**
   * Launch browser and establish CDP WebSocket connection
   */
  async start() {
    this.log('Starting static HTTP server...');
    this.staticServer = await startStaticServer(this.options.rootDir);
    this.log(`Static HTTP server running at ${this.staticServer.url}`);

    const browserExe = findBrowserPath(this.options.browser);
    this.log(`Using browser executable: ${browserExe}`);

    const cdpPort = await getFreePort();
    this.cdpPort = cdpPort;
    this.tempUserDataDir = path.join(
      os.tmpdir(),
      `kaj_cdp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
    fs.mkdirSync(this.tempUserDataDir, { recursive: true });

    const args = [
      this.options.headless ? '--headless=new' : '--start-maximized',
      `--remote-debugging-port=${cdpPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${this.tempUserDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--disable-default-apps',
      '--disable-extensions',
      '--mute-audio',
      ...(this.options.gpu ? [] : ['--disable-gpu']),
      `--window-size=${this.options.viewport.width},${this.options.viewport.height}`,
      'about:blank'
    ];

    this.log(`Spawning browser on CDP port ${cdpPort}...`);
    this.browserProcess = spawn(browserExe, args, { stdio: 'ignore' });

    // Register process exit cleanup hook
    if (!this._cleanupRegistered) {
      this._cleanupRegistered = true;
      const cleanExit = () => {
        try {
          this.closeSync();
        } catch (_) {}
      };
      process.on('exit', cleanExit);
      process.on('SIGINT', cleanExit);
      process.on('SIGTERM', cleanExit);
    }

    // Wait for CDP endpoint to respond
    const pageTarget = await this._waitForTarget(cdpPort, 15000);
    this.log(`Attaching to page target: ${pageTarget.webSocketDebuggerUrl}`);

    // Connect WebSocket
    await this._connectWebSocket(pageTarget.webSocketDebuggerUrl);

    // Enable necessary CDP domains
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Console.enable');

    this.log('CDP Test Harness started successfully.');
    return this;
  }

  /**
   * Poll /json/list until page target is available
   */
  async _waitForTarget(port, timeoutMs) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const targets = await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/json/list`, res => {
            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on('error', reject);
          req.setTimeout(1000, () => req.destroy());
        });

        if (Array.isArray(targets) && targets.length > 0) {
          const pageTarget = targets.find(t => t.type === 'page') || targets[0];
          if (pageTarget && pageTarget.webSocketDebuggerUrl) {
            return pageTarget;
          }
        }
      } catch (err) {
        // Retry
      }
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for CDP target on port ${port} after ${timeoutMs}ms`);
  }

  /**
   * Connect WebSocket to page debugger URL
   */
  _connectWebSocket(wsUrl) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.log('WebSocket connection established.');
        resolve();
      });

      this.ws.on('error', err => {
        this.log('WebSocket error:', err.message);
        reject(err);
      });

      this.ws.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleCDPMessage(msg);
        } catch (e) {
          this.log('Failed to parse CDP message:', e);
        }
      });

      this.ws.on('close', () => {
        this.log('WebSocket closed.');
      });
    });
  }

  /**
   * Handle incoming CDP messages (responses and notifications)
   */
  _handleCDPMessage(msg) {
    // 1. Check if it's a response to a pending request
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject, method } = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        reject(new Error(`CDP Error in ${method}: ${msg.error.message} (${msg.error.code})`));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // 2. Event notifications
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params.exceptionDetails;
      const desc = details.exception ? details.exception.description : details.text;
      const errInfo = {
        text: details.text,
        url: details.url,
        lineNumber: details.lineNumber,
        columnNumber: details.columnNumber,
        description: desc,
        raw: details
      };
      this.exceptions.push(errInfo);
      this.log(`[Exception Captured] line ${details.lineNumber}: ${desc}`);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args, timestamp } = msg.params;
      const text = args
        .map(a => (a.value !== undefined ? String(a.value) : a.description || ''))
        .join(' ');
      const entry = { type, text, timestamp, raw: msg.params };
      this.consoleMessages.push(entry);
      this.log(`[Console ${type}] ${text}`);
    } else if (msg.method === 'Page.loadEventFired') {
      this.loadEventFired = true;
      this.log('[Page.loadEventFired]');
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      // Auto-dismiss dialogs (alert, confirm, prompt)
      this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  }

  /**
   * Send CDP command
   * @param {string} method
   * @param {object} params
   * @param {number} timeoutMs
   * @returns {Promise<any>}
   */
  send(method, params = {}, timeoutMs = 15000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not open'));
    }

    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`CDP command '${method}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        method,
        resolve: res => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: err => {
          clearTimeout(timer);
          reject(err);
        }
      });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Navigate to a file or URL
   * @param {string} target 'game.html' or full URL
   * @param {object} options
   */
  async navigate(target, options = {}) {
    const opts = Object.assign({ timeout: 15000, waitUntil: 'load' }, options);
    let url = target;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      const cleanPath = target.startsWith('/') ? target.slice(1) : target;
      url = `${this.staticServer.url}/${cleanPath}`;
    }
    // game.html asks for a graphics setting on the loading screen unless ?quality= is given
    if (/(^|\/)game\.html(\?|$)/.test(url) && !/[?&]quality=/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'quality=high';
    }

    this.loadEventFired = false;
    this.log(`Navigating to ${url}...`);

    await this.send('Page.navigate', { url });

    if (opts.waitUntil === 'load') {
      const startTime = Date.now();
      while (!this.loadEventFired && Date.now() - startTime < opts.timeout) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!this.loadEventFired) {
        this.log(`Warning: Page load event not fired within ${opts.timeout}ms, continuing.`);
      }
    }

    // Give page a short grace period for async initialization
    await new Promise(r => setTimeout(r, 500));
  }

  /**
   * Evaluate JavaScript in the page context
   * @param {string | Function} script
   * @param  {...any} args
   */
  async evaluate(script, ...args) {
    let expression;
    if (typeof script === 'function') {
      expression = `(${script.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;
    } else {
      expression = script;
    }

    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception
        ? result.exceptionDetails.exception.description
        : result.exceptionDetails.text;
      throw new Error(`Evaluation Error: ${desc}`);
    }

    return result.result ? result.result.value : undefined;
  }

  /**
   * Poll predicate until truthy or timeout
   * @param {string | Function} predicate
   * @param {object} options
   */
  async waitForFunction(predicate, options = {}) {
    const timeout = options.timeout || this.options.timeout;
    const pollInterval = options.pollInterval || 100;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const val = await this.evaluate(predicate);
        if (val) return val;
      } catch (e) {
        // Ignore evaluation errors during polling
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }

    throw new Error(`Timed out waiting for predicate function after ${timeout}ms`);
  }

  /**
   * Wait for window.__GAME__ and window.__GAME__.isReady === true
   * @param {number} timeoutMs
   */
  async waitForGameReady(timeoutMs = 15000) {
    return this.waitForFunction(
      () => typeof window.__GAME__ === 'object' && window.__GAME__ !== null && window.__GAME__.isReady === true,
      { timeout: timeoutMs }
    );
  }

  /**
   * Wait for window.__GAME__.map and window.__GAME__.map.isLoaded === true
   * @param {number} timeoutMs
   */
  async waitForMapLoaded(timeoutMs = 15000) {
    return this.waitForFunction(
      () => typeof window.__GAME__ === 'object' && window.__GAME__ !== null && window.__GAME__.map && window.__GAME__.map.isLoaded === true,
      { timeout: timeoutMs }
    );
  }

  /**
   * Get all captured uncaught page exceptions
   */
  getExceptions() {
    return [...this.exceptions];
  }

  /**
   * Get console error messages
   */
  getConsoleErrors() {
    return this.consoleMessages.filter(m => m.type === 'error');
  }

  /**
   * Get all console messages
   */
  getAllConsoleMessages() {
    return [...this.consoleMessages];
  }

  /**
   * Clear captured exceptions and console logs
   */
  clearLogs() {
    this.exceptions = [];
    this.consoleMessages = [];
  }

  /**
   * Asynchronously shut down harness, browser, and server
   */
  async close() {
    if (this.isClosed) return;
    this.isClosed = true;

    this.log('Closing CDP session...');
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    if (this.browserProcess && !this.browserProcess.killed) {
      const pid = this.browserProcess.pid;
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        } else {
          this.browserProcess.kill('SIGKILL');
        }
      } catch (_) {}
      this.browserProcess = null;
    }

    if (this.tempUserDataDir) {
      try {
        fs.rmSync(this.tempUserDataDir, { recursive: true, force: true, maxRetries: 3 });
      } catch (_) {}
      this.tempUserDataDir = null;
    }

    if (this.staticServer) {
      try {
        await this.staticServer.close();
      } catch (_) {}
      this.staticServer = null;
    }

    this.log('CDP Test Harness closed.');
  }

  /**
   * Synchronous cleanup for process exit hook
   */
  closeSync() {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
    }

    if (this.browserProcess && !this.browserProcess.killed) {
      const pid = this.browserProcess.pid;
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        } else {
          this.browserProcess.kill('SIGKILL');
        }
      } catch (_) {}
    }

    if (this.tempUserDataDir) {
      try {
        fs.rmSync(this.tempUserDataDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}

/**
 * Factory helper
 * @param {object} options
 * @returns {CDPHarness}
 */
function createHarness(options = {}) {
  return new CDPHarness(options);
}

module.exports = {
  CDPHarness,
  createHarness,
  findBrowserPath,
  startStaticServer
};
