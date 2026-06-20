const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_PATH = path.join(__dirname, '../../data/auth.json');
const DEFAULT_USERNAME = 'Legion';
const DEFAULT_PASSWORD = 'Welcome21Legion!';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const sessions = new Map();

function ensureAuthDir() {
  const dir = path.dirname(AUTH_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    passwordHash: hashPassword(password, salt),
    salt,
  };
}

function verifyPassword(password, record) {
  const hash = hashPassword(password, record.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(record.passwordHash, 'hex'));
}

function loadAuthConfig() {
  ensureAuthDir();
  if (!fs.existsSync(AUTH_PATH)) {
    const now = new Date().toISOString();
    const { passwordHash, salt } = createPasswordRecord(DEFAULT_PASSWORD);
    const config = {
      username: DEFAULT_USERNAME,
      passwordHash,
      salt,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    };
    fs.writeFileSync(AUTH_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return config;
  }

  const raw = fs.readFileSync(AUTH_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveAuthConfig(config) {
  ensureAuthDir();
  config.updatedAt = new Date().toISOString();
  fs.writeFileSync(AUTH_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { username, expiresAt });
  return { token, expiresAt };
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function login(username, password) {
  const config = loadAuthConfig();
  if (username !== config.username || !verifyPassword(password, config)) {
    const error = new Error('Invalid username or password');
    error.statusCode = 401;
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  const session = createSession(username);
  return {
    token: session.token,
    expiresAt: new Date(session.expiresAt).toISOString(),
    username: config.username,
    mustChangePassword: config.mustChangePassword,
  };
}

function getSessionInfo(token) {
  const session = getSession(token);
  if (!session) {
    return { authenticated: false };
  }

  const config = loadAuthConfig();
  return {
    authenticated: true,
    username: session.username,
    mustChangePassword: config.mustChangePassword,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

function changePassword(token, currentPassword, newPassword) {
  const session = getSession(token);
  if (!session) {
    const error = new Error('Not authenticated');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!newPassword || newPassword.length < 8) {
    const error = new Error('New password must be at least 8 characters');
    error.statusCode = 400;
    error.code = 'WEAK_PASSWORD';
    throw error;
  }

  const config = loadAuthConfig();
  if (!verifyPassword(currentPassword, config)) {
    const error = new Error('Current password is incorrect');
    error.statusCode = 401;
    error.code = 'INVALID_PASSWORD';
    throw error;
  }

  const { passwordHash, salt } = createPasswordRecord(newPassword);
  config.passwordHash = passwordHash;
  config.salt = salt;
  config.mustChangePassword = false;
  saveAuthConfig(config);

  return {
    success: true,
    mustChangePassword: false,
    message: 'Password changed successfully',
  };
}

function logout(token) {
  destroySession(token);
  return { success: true };
}

module.exports = {
  AUTH_PATH,
  SESSION_COOKIE: 'sentry_session',
  SESSION_TTL_MS,
  loadAuthConfig,
  parseCookies,
  login,
  logout,
  getSession,
  getSessionInfo,
  changePassword,
  createSession,
  destroySession,
};
