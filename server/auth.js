const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper for atomic file write
async function saveJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

// Load JSON safely
function loadJsonSync(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return defaultValue;
}

// In-memory data structures backed by JSON files
const users = loadJsonSync(USERS_FILE, {}); // username -> { id, username, hash, salt, createdAt }
const sessions = loadJsonSync(SESSIONS_FILE, {}); // token -> { userId, username, createdAt }

// Rate limiting for /api/login: 10 req / minute per IP
const loginRateLimit = new Map(); // ip -> [timestamps]

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxReq = 10;

  let attempts = loginRateLimit.get(ip) || [];
  attempts = attempts.filter(ts => now - ts < windowMs);

  if (attempts.length >= maxReq) {
    loginRateLimit.set(ip, attempts);
    return false;
  }

  attempts.push(now);
  loginRateLimit.set(ip, attempts);
  return true;
}

// Scrypt hashing helper
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

// Register user
async function registerUser(username, password) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9]{3,16}$/.test(username)) {
    throw new Error('Username harus 3-16 karakter alfanumerik.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password minimal 8 karakter.');
  }

  const lowerUsername = username.toLowerCase();
  for (const uid in users) {
    if (users[uid].username.toLowerCase() === lowerUsername) {
      throw new Error('Username sudah digunakan.');
    }
  }

  const userId = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);

  const newUser = {
    id: userId,
    username,
    hash,
    salt,
    createdAt: Date.now()
  };

  users[userId] = newUser;
  await saveJsonAtomic(USERS_FILE, users);

  // Create session
  const token = crypto.randomUUID();
  sessions[token] = {
    userId,
    username,
    createdAt: Date.now()
  };
  await saveJsonAtomic(SESSIONS_FILE, sessions);

  return { token, user: { id: userId, username } };
}

// Login user
async function loginUser(username, password, ip) {
  if (!checkLoginRateLimit(ip)) {
    throw new Error('Terlalu banyak percobaan login. Coba lagi dalam 1 menit.');
  }

  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new Error('Username dan password wajib diisi.');
  }

  const lowerUsername = username.toLowerCase();
  let foundUser = null;
  for (const uid in users) {
    if (users[uid].username.toLowerCase() === lowerUsername) {
      foundUser = users[uid];
      break;
    }
  }

  if (!foundUser) {
    throw new Error('Username atau password salah.');
  }

  const hash = await hashPassword(password, foundUser.salt);
  if (crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(foundUser.hash, 'hex')) === false) {
    throw new Error('Username atau password salah.');
  }

  const token = crypto.randomUUID();
  sessions[token] = {
    userId: foundUser.id,
    username: foundUser.username,
    createdAt: Date.now()
  };
  await saveJsonAtomic(SESSIONS_FILE, sessions);

  return { token, user: { id: foundUser.id, username: foundUser.username } };
}

// Logout user
async function logoutUser(token) {
  if (token && sessions[token]) {
    delete sessions[token];
    await saveJsonAtomic(SESSIONS_FILE, sessions);
  }
}

// Validate session token
function validateSession(token) {
  if (!token || !sessions[token]) {
    return null;
  }
  return sessions[token];
}

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  validateSession
};
