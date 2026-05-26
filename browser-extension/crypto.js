// ── APTOGON Ed25519 crypto helpers ───────────────────────────────────────────
//
// Работает через WebCrypto API (нативный браузерный крипто, без зависимостей).
// Chrome 113+, Firefox 130+, Safari 17+ поддерживают Ed25519.
//
// Private key хранится в localStorage('aptogon_key') как base64url (32 bytes).
// WebCrypto требует PKCS#8 формат для importKey — конвертируем на лету.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// PKCS#8 обёртка для raw Ed25519 private key (32 bytes).
// Стандартный ASN.1 header для Ed25519 (RFC 8410):
//   SEQUENCE { INTEGER 0; SEQUENCE { OID 1.3.101.112 }; OCTET STRING { OCTET STRING raw_key } }
const PKCS8_ED25519_HEADER = new Uint8Array([
  0x30, 0x2e,  // SEQUENCE (46 bytes)
  0x02, 0x01, 0x00,  // INTEGER 0 (version)
  0x30, 0x05,        // SEQUENCE (5 bytes) — AlgorithmIdentifier
    0x06, 0x03, 0x2b, 0x65, 0x70,  // OID 1.3.101.112 (Ed25519)
  0x04, 0x22,        // OCTET STRING (34 bytes)
    0x04, 0x20,      // OCTET STRING (32 bytes) — raw private key follows
]);

// ── Утилиты ───────────────────────────────────────────────────────────────────

function base64urlDecode(str) {
  // Восстанавливаем padding и меняем символы
  const padded = str + '=='.slice((str.length + 3) % 4 + 1);
  const std = padded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function base64urlEncode(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textEncode(str) {
  return new TextEncoder().encode(str);
}

// ── Импорт ключа ──────────────────────────────────────────────────────────────

/**
 * Импортирует Ed25519 private key из raw 32 bytes в WebCrypto CryptoKey.
 * @param {Uint8Array} rawBytes — 32 байта приватного ключа
 * @returns {Promise<CryptoKey>}
 */
async function importEd25519PrivateKey(rawBytes) {
  if (rawBytes.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${rawBytes.length}`);
  }
  // Собираем PKCS#8 буфер: header + raw key
  const pkcs8 = new Uint8Array(PKCS8_ED25519_HEADER.length + rawBytes.length);
  pkcs8.set(PKCS8_ED25519_HEADER);
  pkcs8.set(rawBytes, PKCS8_ED25519_HEADER.length);

  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8.buffer,
    { name: 'Ed25519' },
    false,          // не экспортируемый из WebCrypto (уже есть в localStorage)
    ['sign'],
  );
}

// ── Основная функция подписи ──────────────────────────────────────────────────

/**
 * Подписывает одобрение bond-запроса.
 *
 * Канонический формат сообщения (совпадает с бэкендом):
 *   "aptogon-bond-approval:v1:{request_id}:{requester_did}:{timestamp}"
 *
 * Ed25519 подписывает raw bytes (без предварительного хеширования).
 *
 * @param {string} requestId    — UUID bond-запроса
 * @param {string} requesterDid — DID того кого одобряем
 * @param {number} timestamp    — unix секунды момента подписи
 * @returns {Promise<string>}   — base64url подпись (64 bytes → ~86 chars)
 */
async function signBondApproval(requestId, requesterDid, timestamp) {
  const privateKeyB64 = localStorage.getItem('aptogon_key');
  if (!privateKeyB64) {
    throw new Error('No private key in localStorage (aptogon_key). Verify first.');
  }

  const rawKey = base64urlDecode(privateKeyB64);
  const cryptoKey = await importEd25519PrivateKey(rawKey);

  const message = `aptogon-bond-approval:v1:${requestId}:${requesterDid}:${timestamp}`;
  const msgBytes = textEncode(message);

  // Ed25519 подписывает сообщение напрямую (SHA-512 применяется внутри алгоритма)
  const sigBuffer = await crypto.subtle.sign('Ed25519', cryptoKey, msgBytes);
  return base64urlEncode(new Uint8Array(sigBuffer));
}

/**
 * Отправляет одобрение bond-запроса с криптографической подписью.
 *
 * @param {string} requestId    — UUID bond-запроса
 * @param {string} requesterDid — DID того кого одобряем (из bond request)
 * @returns {Promise<object>}   — ответ сервера
 */
async function approveBondRequest(requestId, requesterDid) {
  const approverDid = localStorage.getItem('hsi_did');
  if (!approverDid) {
    throw new Error('Not verified — no DID in localStorage.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signBondApproval(requestId, requesterDid, timestamp);

  const res = await fetch('https://homosapience.org/api/bond/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id:   requestId,
      approver_did: approverDid,
      timestamp,
      signature,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Верификация (для отладки и unit-тестов) ───────────────────────────────────

/**
 * Проверяет подпись локально (без обращения к серверу).
 * Используется в тестах и для отладки.
 *
 * @param {string} approverDid — did:key строка
 * @param {string} requestId
 * @param {string} requesterDid
 * @param {number} timestamp
 * @param {string} signatureB64url
 * @returns {Promise<boolean>}
 */
async function verifyBondApproval(approverDid, requestId, requesterDid, timestamp, signatureB64url) {
  try {
    // Извлекаем публичный ключ из did:key
    const pubBytes = didKeyToPublicBytes(approverDid);
    const pubKey = await crypto.subtle.importKey(
      'raw', pubBytes, { name: 'Ed25519' }, false, ['verify'],
    );

    const message = `aptogon-bond-approval:v1:${requestId}:${requesterDid}:${timestamp}`;
    const msgBytes = textEncode(message);
    const sigBytes = base64urlDecode(signatureB64url);

    return crypto.subtle.verify('Ed25519', pubKey, sigBytes, msgBytes);
  } catch {
    return false;
  }
}

/**
 * Извлекает 32 байта Ed25519 публичного ключа из did:key строки.
 * @param {string} did — "did:key:z6Mk..."
 * @returns {Uint8Array} — 32 bytes
 */
function didKeyToPublicBytes(did) {
  const suffix = did.replace('did:key:', '');
  if (!suffix.startsWith('z')) throw new Error('Expected base58btc multibase (z prefix)');
  const decoded = base58Decode(suffix.slice(1));
  // Первые 2 байта — multicodec prefix (0xed 0x01), остальные — ключ
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Not an Ed25519 DID key (expected 0xed 0x01 prefix)');
  }
  return decoded.slice(2);
}

// ── Base58 декодер (для извлечения ключа из DID) ──────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str) {
  let n = BigInt(0);
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error(`Invalid base58 char: ${char}`);
    n = n * 58n + BigInt(idx);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  const leadingZeros = str.match(/^1*/)[0].length;
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

// ── Экспорт ───────────────────────────────────────────────────────────────────

// Экспортируем для использования из popup.js и background.js
if (typeof module !== 'undefined') {
  module.exports = { signBondApproval, approveBondRequest, verifyBondApproval };
}
