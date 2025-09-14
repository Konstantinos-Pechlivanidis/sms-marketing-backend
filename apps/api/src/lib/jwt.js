const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';

function signAccessToken(payload){ return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL }); }
function verifyAccessToken(token){ return jwt.verify(token, JWT_SECRET); }

module.exports = { signAccessToken, verifyAccessToken };
