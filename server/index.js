const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const { setupWebSocket } = require('./net');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Helper to read request body as JSON
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // Max 1MB
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', err => reject(err));
  });
}

// Helper to send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

// Serve static files
function serveStaticFile(req, res, reqPath) {
  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? 'index.html' : reqPath);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers = { 'Content-Type': contentType };

    // Apply immutable long caching for vendored libraries (e.g., three.module.js)
    if (reqPath.startsWith('/vendor/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  // API Endpoints
  if (pathname.startsWith('/api/')) {
    try {
      if (req.method === 'POST' && pathname === '/api/register') {
        const { username, password } = await parseRequestBody(req);
        const result = await auth.registerUser(username, password);
        return sendJson(res, 201, { success: true, ...result });
      }

      if (req.method === 'POST' && pathname === '/api/login') {
        const { username, password } = await parseRequestBody(req);
        const result = await auth.loginUser(username, password, ip);
        return sendJson(res, 200, { success: true, ...result });
      }

      if (req.method === 'POST' && pathname === '/api/logout') {
        const authHeader = req.headers.authorization;
        const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
        await auth.logoutUser(token);
        return sendJson(res, 200, { success: true });
      }

      if (req.method === 'GET' && pathname === '/api/me') {
        const authHeader = req.headers.authorization;
        const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
        const session = auth.validateSession(token);
        if (!session) {
          return sendJson(res, 401, { success: false, error: 'Unauthorized' });
        }
        return sendJson(res, 200, { success: true, user: { id: session.userId, username: session.username } });
      }

      return sendJson(res, 404, { success: false, error: 'API endpoint not found' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message || 'Bad Request' });
    }
  }

  // Static files
  serveStaticFile(req, res, pathname);
});

setupWebSocket(server);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ValWars Server listening on http://0.0.0.0:${PORT}`);
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`LAN: http://${net.address}:${PORT}`);
        }
      }
    }
  });
}

module.exports = { server };
