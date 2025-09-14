const { verifyAccessToken } = require('../lib/jwt');
module.exports = function requireAuth(req,res,next){
  const hdr = req.headers.authorization || '';
  const [type, token] = hdr.split(' ');
  if(type!=='Bearer' || !token) return res.status(401).json({ message:'Missing token' });
  try { const p = verifyAccessToken(token); req.user = { id:p.sub, email:p.email }; next(); }
  catch { res.status(401).json({ message:'Invalid token' }); }
};
