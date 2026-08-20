const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'schimba-acest-secret-in-productie';
const SELLER_COOKIE = 'vanzator_sesiune';
const ADMIN_COOKIE = 'admin_sesiune';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 zile

function sign(value) {
  const sig = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}

function verify(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const idx = cookieValue.lastIndexOf('.');
  if (idx === -1) return null;
  const id = cookieValue.slice(0, idx);
  const sig = cookieValue.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(id).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  return id;
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    secure: process.env.NODE_ENV === 'production',
  };
}

function setSellerCookie(res, sellerId) {
  res.cookie(SELLER_COOKIE, sign(sellerId), cookieOpts());
}
function clearSellerCookie(res) {
  res.clearCookie(SELLER_COOKIE);
}
function getSellerIdFromReq(req) {
  return verify(req.cookies ? req.cookies[SELLER_COOKIE] : null);
}

function setAdminCookie(res) {
  res.cookie(ADMIN_COOKIE, sign('admin'), cookieOpts());
}
function clearAdminCookie(res) {
  res.clearCookie(ADMIN_COOKIE);
}
function isAdminReq(req) {
  return verify(req.cookies ? req.cookies[ADMIN_COOKIE] : null) === 'admin';
}

module.exports = {
  setSellerCookie, clearSellerCookie, getSellerIdFromReq,
  setAdminCookie, clearAdminCookie, isAdminReq,
};
