const crypto = require('crypto');

// Product codes (first 2 chars of key)
const PRODUCTS = {
  phi: 'PH',
  helix: 'HX',
  alpha: 'AL',
  omega: 'OM',
  bundle: 'BN',
  aletheia: 'AT',
};

const VERSION = '10';
const SECRET_SALT = 'PhiHelix2026AW';

function generateChecksum(keyParts) {
  const hash = crypto.createHash('sha256').update(keyParts + SECRET_SALT).digest('hex');
  const chars = hash.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
  return chars;
}

function generateUserHash(email) {
  const hash = crypto.createHash('sha256').update(email.toLowerCase().trim() + SECRET_SALT).digest('hex');
  return hash.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
}

function generateRandomComponent() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // No ambiguous chars
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateLicenseKey(productCode) {
  const product = productCode + VERSION;
  const random1 = generateRandomComponent();
  const random2 = generateRandomComponent();
  const keyBase = product + random1 + random2;
  const checksum = generateChecksum(keyBase);
  const full = keyBase + checksum;
  return `${full.slice(0,4)}-${full.slice(4,8)}-${full.slice(8,12)}-${full.slice(12,16)}`;
}

function validateKey(key) {
  const clean = key.replace(/-/g, '').toUpperCase();
  if (clean.length !== 16) return { valid: false, error: 'Invalid key length' };

  const productCode = clean.slice(0, 2);
  const keyBase = clean.slice(0, 12);
  const checksum = clean.slice(12, 16);
  const expectedChecksum = generateChecksum(keyBase);

  if (checksum !== expectedChecksum) return { valid: false, error: 'Invalid checksum' };

  let product = null;
  for (const [name, code] of Object.entries(PRODUCTS)) {
    if (code === productCode) { product = name; break; }
  }
  if (!product) return { valid: false, error: 'Unknown product code' };

  return { valid: true, product, productCode };
}

module.exports = { generateLicenseKey, validateKey, generateChecksum, PRODUCTS, SECRET_SALT };
