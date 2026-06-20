const express = require('express');
const authService = require('../services/auth');
const logsService = require('../services/logs');

const router = express.Router();

function setSessionCookie(res, token) {
  const maxAge = Math.floor(authService.SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${authService.SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${authService.SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`,
  );
}

router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = authService.login(username, password);
    setSessionCookie(res, result.token);

    logsService.addLog({
      level: 'info',
      service: 'system',
      message: `Login success — user ${result.username}`,
    });

    res.json({
      success: true,
      username: result.username,
      mustChangePassword: result.mustChangePassword,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') {
      logsService.addLog({
        level: 'warn',
        service: 'system',
        message: `Login failure — user ${req.body?.username || 'unknown'}`,
      });
    }
    next(err);
  }
});

router.post('/logout', (req, res) => {
  const cookies = authService.parseCookies(req.headers.cookie);
  const token = cookies[authService.SESSION_COOKIE];
  authService.logout(token);
  clearSessionCookie(res);
  logsService.addLog({ level: 'info', service: 'system', message: 'User logged out' });
  res.json({ success: true });
});

router.get('/session', (req, res) => {
  const cookies = authService.parseCookies(req.headers.cookie);
  const token = cookies[authService.SESSION_COOKIE];
  res.json(authService.getSessionInfo(token));
});

router.post('/change-password', (req, res, next) => {
  try {
    const cookies = authService.parseCookies(req.headers.cookie);
    const token = cookies[authService.SESSION_COOKIE];
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    const result = authService.changePassword(token, currentPassword, newPassword);
    logsService.addLog({ level: 'info', service: 'system', message: 'Password changed' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
