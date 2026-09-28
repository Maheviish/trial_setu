// src/auth.js - Authentication & Role-Based Access Control (RBAC)
// Uses HMAC-SHA256 signed session tokens & scrypt verification.

const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'trialsetu-aiia-sih-ps26046-secure-secret-key-2026';

// Create HMAC-signed session token
function createToken(payload, expiresInHours = 24) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + (expiresInHours * 3600);
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${data}`)
    .digest('base64url');
  return `${header}.${data}.${signature}`;
}

// Verify HMAC-signed session token
function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, data, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET)
      .update(`${header}.${data}`)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch (err) {
    return null;
  }
}

// Middleware: Authenticate Request
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required. Missing Authorization header.' });
  }

  const parts = authHeader.split(' ');
  const token = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : authHeader;

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }

  req.user = user;
  next();
}

// Optional Auth (for voice reporting or guest access)
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    const token = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : authHeader;
    req.user = verifyToken(token) || null;
  } else {
    req.user = null;
  }
  next();
}

// Middleware: Require specific role(s)
function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    // Regulators are strictly read-only by design and cannot execute writes
    if (req.user.role === 'regulator' && req.method !== 'GET') {
      return res.status(403).json({
        error: 'Forbidden: CDSCO/AYUSH Regulator role is strictly read-only for independent oversight.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: Role '${req.user.role}' is not authorized. Allowed roles: ${allowedRoles.join(', ')}.`
      });
    }

    next();
  };
}

module.exports = {
  createToken,
  verifyToken,
  authenticate,
  optionalAuthenticate,
  requireRoles,
  hashPassword,
  verifyPassword
};
