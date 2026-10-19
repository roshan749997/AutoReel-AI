import crypto from 'crypto';
import { config } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a consistent 32-byte key from the configured encryption key
 */
const getKey = () => {
  const secret = config.encryptionKey || 'default_insecure_key_must_change_in_production_32b!';
  return crypto.createHash('sha256').update(String(secret)).digest();
};

/**
 * Encrypts plain text using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Combined string formatted as: iv:authTag:encryptedHex
 */
export const encrypt = (text) => {
  if (!text) return text;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
};

/**
 * Decrypts text previously encrypted by encrypt()
 * @param {string} encryptedPayload - Combined string: iv:authTag:encryptedHex
 * @returns {string} - Original plain text
 */
export const decrypt = (encryptedPayload) => {
  if (!encryptedPayload) return encryptedPayload;
  
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = getKey();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

/**
 * Generates an HMAC-signed OAuth state string to prevent CSRF attacks during callbacks
 * Format: base64url(platform:timestamp:randomNonce:signature)
 */
export const generateOAuthState = (platform) => {
  const timestamp = Date.now().toString();
  const randomNonce = crypto.randomBytes(8).toString('hex');
  const payload = `${platform}:${timestamp}:${randomNonce}`;
  const key = getKey();
  const signature = crypto.createHmac('sha256', key).update(payload).digest('hex');

  return Buffer.from(`${payload}:${signature}`).toString('base64url');
};

/**
 * Validates an HMAC-signed OAuth state string and checks expiration
 * @param {string} stateString - The received state parameter from callback
 * @param {string} expectedPlatform - 'youtube' | 'instagram'
 * @param {number} maxAgeMs - Maximum valid age (defaults to 15 minutes)
 * @returns {boolean} - True if signature is valid, platform matches, and not expired
 */
export const verifyOAuthState = (stateString, expectedPlatform, maxAgeMs = 15 * 60 * 1000) => {
  if (!stateString || typeof stateString !== 'string') return false;
  try {
    const decoded = Buffer.from(stateString, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return false;

    const [platform, timestampStr, randomNonce, signature] = parts;
    if (expectedPlatform && platform !== expectedPlatform) return false;

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp) || Date.now() - timestamp > maxAgeMs || timestamp > Date.now() + 60000) {
      return false; // Expired or future timestamp
    }

    const payload = `${platform}:${timestampStr}:${randomNonce}`;
    const key = getKey();
    const expectedSignature = crypto.createHmac('sha256', key).update(payload).digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSignature, 'hex');

    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
};
