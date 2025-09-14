const express = require('express');
const { register, login, refresh, logout } = require('../modules/auth.service');
const router = express.Router();
const REFRESH_COOKIE = 'rt';

function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: false, expires: expiresAt });
}

router.post('/auth/register', async (req,res)=>{
  try {
    const { email, password, senderName, company } = req.body || {};
    if(!email || !password) return res.status(400).json({ message:'email & password required' });
    const user = await register({ email, password, senderName, company });
    res.status(201).json({ id:user.id, email:user.email, senderName:user.senderName, company:user.company });
  } catch(e){ res.status(400).json({ message:e.message }); }
});

router.post('/auth/login', async (req,res)=>{
  try {
    const { email, password } = req.body || {};
    if(!email || !password) return res.status(400).json({ message:'email & password required' });
    const { user, accessToken, refreshToken, expiresAt } = await login({ email, password });
    setRefreshCookie(res, refreshToken, expiresAt);
    res.json({ accessToken, user:{ id:user.id, email:user.email, senderName:user.senderName, company:user.company } });
  } catch(e){ res.status(401).json({ message:e.message }); }
});

router.post('/auth/refresh', async (req,res)=>{
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if(!token) return res.status(401).json({ message:'No refresh token' });
    const { accessToken, user } = await refresh(token);
    res.json({ accessToken, user:{ id:user.id, email:user.email, senderName:user.senderName, company:user.company } });
  } catch(e){ res.status(401).json({ message:e.message }); }
});

router.post('/auth/logout', async (req,res)=>{
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if(token) await logout(token);
    res.clearCookie(REFRESH_COOKIE);
    res.json({ ok:true });
  } catch(e){ res.status(400).json({ message:e.message }); }
});

module.exports = router;
