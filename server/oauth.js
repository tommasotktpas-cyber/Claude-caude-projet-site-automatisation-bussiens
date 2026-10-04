'use strict';
// "Continuer avec Google / Apple" (OpenID Connect, authorization code flow) — no SDK.
// Enabled per provider when its credentials are present in the environment.
const crypto = require('node:crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const PROVIDERS = {
  google: {
    name: 'Google',
    enabled: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    scope: 'openid email profile',
    extraAuth: { prompt: 'select_account' },
  },
  apple: {
    name: 'Apple',
    enabled: () => !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    clientId: () => process.env.APPLE_CLIENT_ID,
    clientSecret: () => appleClientSecret(),
    scope: 'name email',
    extraAuth: { response_mode: 'form_post' },
  },
};

/** Apple's client secret is a short-lived ES256 JWT signed with the developer key. */
function appleClientSecret() {
  const header = { alg: 'ES256', kid: process.env.APPLE_KEY_ID };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: process.env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: process.env.APPLE_CLIENT_ID };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = String(process.env.APPLE_PRIVATE_KEY).replace(/\\n/g, '\n');
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64url(sig)}`;
}

function authorizeUrl(providerId, { redirectUri, state, nonce }) {
  const p = PROVIDERS[providerId];
  const q = new URLSearchParams({
    client_id: p.clientId(), redirect_uri: redirectUri, response_type: 'code', scope: p.scope, state, nonce, ...p.extraAuth,
  });
  return `${p.authUrl}?${q}`;
}

const jwksCache = new Map();
async function getKey(p, kid) {
  const cached = jwksCache.get(p.jwksUrl);
  let keys = cached && cached.exp > Date.now() ? cached.keys : null;
  if (!keys || !keys.find((k) => k.kid === kid)) {
    const res = await fetch(p.jwksUrl);
    keys = (await res.json()).keys || [];
    jwksCache.set(p.jwksUrl, { keys, exp: Date.now() + 3600_000 });
  }
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error('Clé de signature inconnue.');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

/** Verifies an RS256 ID token: signature, issuer, audience, expiry, nonce. */
async function verifyIdToken(providerId, idToken, nonce) {
  const p = PROVIDERS[providerId];
  const [h, pl, sig] = String(idToken).split('.');
  if (!h || !pl || !sig) throw new Error('Jeton invalide.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(pl, 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error('Algorithme non pris en charge.');
  const key = await getKey(p, header.kid);
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${pl}`), key, Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('Signature invalide.');
  if (!p.issuers.includes(claims.iss)) throw new Error('Émetteur invalide.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(p.clientId())) throw new Error('Audience invalide.');
  if (claims.exp * 1000 < Date.now()) throw new Error('Jeton expiré.');
  if (nonce && claims.nonce !== nonce) throw new Error('Nonce invalide.');
  return claims;
}

async function exchangeCode(providerId, { code, redirectUri }) {
  const p = PROVIDERS[providerId];
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: p.clientId(), client_secret: p.clientSecret() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(data.error_description || data.error || 'Échange du code impossible.');
  return data;
}

const enabledProviders = () => Object.entries(PROVIDERS).filter(([, p]) => p.enabled()).map(([id, p]) => ({ id, name: p.name }));

module.exports = { PROVIDERS, authorizeUrl, exchangeCode, verifyIdToken, enabledProviders, appleClientSecret };
