/**
 * Security primitives: passwords, signed session cookies, and TOTP two-factor.
 *
 * Everything here is pure and side-effect free except `loadSessionSecret`,
 * which creates the local secret file once. Nothing in this module logs a
 * password, a hash, a session token, or a two-factor secret.
 *
 * Session cookies are stateless: a base64url payload signed with HMAC-SHA256.
 * They carry only a user id, role, and expiry — never a password or profile.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const COOKIE_NAME = 'pm_session';
export const MFA_COOKIE_NAME = 'pm_mfa';
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const MFA_CHALLENGE_MS = 5 * 60 * 1000;

// One policy, one message. Every place that sets a password uses this so a
// customer, a branch head, and the owner all get the same rule.
export const PASSWORD_RULES =
  'Use at least 10 characters, including an uppercase letter, a lowercase letter, a number, and a symbol.';

/**
 * Returns a human-readable problem message, or '' when the password is fine.
 * One function for every role keeps the rule identical for customers, branch
 * heads, and the owner.
 */
export function passwordProblem(password) {
  const value = String(password ?? '');
  if (value.length < 10 || value.length > 128) return PASSWORD_RULES;
  if (!/[A-Z]/.test(value)) return PASSWORD_RULES;
  if (!/[a-z]/.test(value)) return PASSWORD_RULES;
  if (!/\d/.test(value)) return PASSWORD_RULES;
  if (!/[^A-Za-z0-9]/.test(value)) return PASSWORD_RULES;
  return '';
}

/**
 * Hashes with scrypt and a fresh 16-byte salt. The stored format is
 * `scrypt:<salt hex>:<hash hex>` so the algorithm can be upgraded later.
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** Constant-time comparison of a candidate password against a stored hash. */
export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * Returns the cookie-signing secret. Priority: SESSION_SECRET from the
 * environment, then `DATA_DIR/session.secret`, generated on first run with
 * owner-only permissions. Rotating it signs every session out.
 */
export function loadSessionSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'session.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/** Builds the signed session cookie value for an authenticated user. */
export function createSessionToken(user, secret) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      sv: Number(user.session_version) || 0,
      exp: Date.now() + SESSION_MS,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * One-way hash used for password-reset links. The session secret acts as a
 * pepper, so a copied database hash alone cannot be turned back into a token.
 * Never store or log the original token.
 */
export function hashOpaqueToken(token, secret) {
  return crypto.createHmac('sha256', secret).update(String(token || '')).digest('base64url');
}

/** Verifies a session cookie; returns its payload, or null if invalid/expired. */
export function readSessionToken(token, secret) {
  const data = readSignedToken(token, secret);
  if (!data || !data.sub || !data.exp) return null;
  return data;
}

/**
 * Shared signature check for the session and MFA cookies: recompute the HMAC,
 * compare in constant time, then enforce the expiry. Any failure returns null
 * rather than throwing, so callers can treat a bad cookie as "signed out".
 */
function readSignedToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// A signed, five-minute cookie that only proves "this password was correct,
// now finish the second factor". It can never be used as a session.
export function createMfaChallenge(user, secret) {
  const payload = Buffer.from(
    JSON.stringify({ sub: user.id, stage: 'mfa', exp: Date.now() + MFA_CHALLENGE_MS })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readMfaChallenge(token, secret) {
  const data = readSignedToken(token, secret);
  if (!data || data.stage !== 'mfa' || !data.sub) return null;
  return data;
}

/**
 * Writes the session cookie. `httpOnly` keeps it out of JavaScript, `sameSite:
 * lax` blocks cross-site POSTs, and `secure` is on in production (HTTPS only).
 */
export function setSessionCookie(res, token, secure) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_MS,
    path: '/',
  });
}

export function setMfaCookie(res, token, secure) {
  res.cookie(MFA_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: MFA_CHALLENGE_MS,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(MFA_COOKIE_NAME, { path: '/' });
}

/**
 * The only shape of a user that may leave the server. Strips `password_hash`,
 * `mfa_secret`, and every other internal column.
 */
export function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branch_id: user.branch_id || null,
    phone: user.phone || '',
    active: user.active !== false,
    mfa_enabled: Boolean(user.mfa_enabled),
    must_change_password: Boolean(user.must_change_password),
    created_at: user.created_at,
  };
}

/* ---------- Two-factor (TOTP, RFC 6238) ---------- */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Creates a fresh base32 secret for a user enrolling in two-factor. */
export function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * The six-digit code for a given moment. TOTP is an HMAC over the 30-second
 * time step, truncated to six digits (RFC 6238), matching Google
 * Authenticator, Authy, and 1Password.
 */
export function totpAt(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30);
  const key = base32Decode(secret);
  if (!key.length) return '';
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

// +/- one 30-second step tolerates a slightly slow phone without widening the
// window enough to invite guessing.
export function verifyTotp(secret, token, window = 1) {
  const value = String(token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(value) || !secret) return false;
  for (let step = -window; step <= window; step += 1) {
    if (totpAt(secret, Date.now() + step * 30_000) === value) return true;
  }
  return false;
}

/* ---------- Two-factor secret encryption at rest ---------- */

const MFA_SECRET_PREFIX = 'enc:v1:';

/** True when a stored factor secret is already encrypted. */
export function isEncryptedMfaSecret(value) {
  return String(value || '').startsWith(MFA_SECRET_PREFIX);
}

// The key is derived from the same server secret that signs sessions, so no
// extra credential has to be distributed. Rotating SESSION_SECRET deliberately
// invalidates existing factors; the owner can reset a customer's 2FA.
function mfaKey(secret) {
  return crypto.createHash('sha256').update(`pm-mfa:${String(secret)}`).digest();
}

/**
 * Encrypts a TOTP secret with AES-256-GCM before it is stored. The database
 * holds only iv:tag:ciphertext, never the base32 value needed to generate codes.
 * Legacy plaintext values are returned unchanged so existing accounts keep
 * working and can be upgraded on their next successful sign-in.
 */
export function encryptMfaSecret(secret, keySecret) {
  if (!secret || isEncryptedMfaSecret(secret)) return secret;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', mfaKey(keySecret), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return `${MFA_SECRET_PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

/** Decrypts a stored factor secret; returns '' when the value cannot be read. */
export function decryptMfaSecret(value, keySecret) {
  const raw = String(value || '');
  if (!raw) return '';
  if (!isEncryptedMfaSecret(raw)) return raw;
  const [ivPart, tagPart, dataPart] = raw.slice(MFA_SECRET_PREFIX.length).split(':');
  if (!ivPart || !tagPart || !dataPart) return '';
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      mfaKey(keySecret),
      Buffer.from(ivPart, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

/** The `otpauth://` URL encoded into the enrollment QR code. */
export function otpauthUrl(secret, email) {
  const label = encodeURIComponent(`Precious Moments:${email}`);
  const query = new URLSearchParams({
    secret,
    issuer: 'Precious Moments',
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
