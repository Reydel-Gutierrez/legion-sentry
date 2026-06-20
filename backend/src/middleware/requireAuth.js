const authService = require('../services/auth');

const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/session',
  '/api/health',
  '/api/system/health',
]);

function requireAuth(req, res, next) {
  const fullPath = req.baseUrl + req.path;
  const normalized = fullPath.replace(/\/+$/, '') || fullPath;

  if (PUBLIC_PATHS.has(normalized) || PUBLIC_PATHS.has(req.path)) {
    return next();
  }

  const cookies = authService.parseCookies(req.headers.cookie);
  const token = cookies[authService.SESSION_COOKIE];
  const session = authService.getSession(token);

  if (!session) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
  }

  req.session = session;
  req.sessionToken = token;
  return next();
}

module.exports = requireAuth;
