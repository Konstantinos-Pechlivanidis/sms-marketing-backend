// apps/api/src/services/sender.util.js
function isAlphaSender(s){ return typeof s==='string' && /^[A-Za-z0-9]{3,11}$/.test(s); }
function isE164(s){ return typeof s==='string' && /^\+[1-9]\d{6,14}$/.test(s); }
function sanitizeSender(s){ return (isAlphaSender(s) || isE164(s)) ? s : null; }
module.exports = { isAlphaSender, isE164, sanitizeSender };
