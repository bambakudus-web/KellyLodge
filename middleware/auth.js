// middleware/auth.js — session-based auth guards

// Blocks the request unless someone is logged in
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'You must be logged in to do that.' });
  }
  next();
}

// Blocks the request unless the logged-in user has one of the allowed roles
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'You must be logged in to do that.' });
    }
    if (!allowedRoles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
