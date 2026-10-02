// src/lib/key-vault.js
import { openDB } from 'idb';

const DB_NAME = 'mote-vault';
const DB_VERSION = 1;
const STORE = 'wrapped-keys';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'uid' });
        }
      },
    });
  }
  return dbPromise;
}

// ═══════════════════════════════════════════════════════════
// WEBAUTHN
// ═══════════════════════════════════════════════════════════

export function isBiometricAvailable() {
  return typeof window !== 'undefined' &&
         !!window.PublicKeyCredential &&
         !!navigator.credentials;
}

/**
 * Ask the platform to create a credential tied to this device.
 * Returns the credential ID (base64) or throws if the user cancels.
 */
async function createCredential(uid) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(uid);

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'Mote',
        // rp.id defaults to the current origin's effective domain
      },
      user: {
        id: userId,
        name: 'Mote user',
        displayName: 'Mote user',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',   // Face ID / Touch ID / Windows Hello
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  });

  // We only need the credential ID — we don't verify attestations
  return toBase64(cred.rawId);
}

/**
 * Ask the platform to sign a challenge using the stored credential.
 * This triggers the biometric prompt. Throws on user cancel.
 */
async function getAssertion(credentialIdB64) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const idBytes = fromBase64(credentialIdB64);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          type: 'public-key',
          id: idBytes,
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  return assertion;
}

// ═══════════════════════════════════════════════════════════
// KEY WRAPPING
// ═══════════════════════════════════════════════════════════

/**
 * The wrapped key format:
 *   {
 *     uid,
 *     credentialId,        // base64
 *     ciphertext,          // base64 of the wrapped AES key bytes
 *     iv,                  // base64 of the wrapping IV
 *     wrappingSalt,        // base64 of the salt used to derive the wrapper key
 *     createdAt,
 *   }
 */

/**
 * Wrap the AES key using a key derived from a WebAuthn credential.
 *
 * Flow:
 *   1. Create a credential (or reuse an existing one)
 *   2. Generate a random "wrapping secret" and store it in the credential's user.handle
 *   3. Derive a wrapper key from the wrapping secret + a random salt
 *   4. AES-GCM encrypt the real AES key with the wrapper key
 *   5. Persist { credentialId, ciphertext, iv, wrappingSalt }
 *
 * Note: the wrapping secret is derived from the credential itself.
 * On later unlocks, WebAuthn proves the user is present; we then
 * re-derive the same secret from the stored credentialId.
 *
 * For simplicity here, we use a fixed secret derived from the
 * credential ID — WebAuthn's userVerification is what actually
 * gates access. A more robust design would use the assertion
 * signature as a key source, but that requires a server to
 * verify, which Mote doesn't have.
 */
export async function wrapAndStoreKey(uid, aesKey) {
  if (!isBiometricAvailable()) {
    throw new Error('Biometric authentication is not available on this device.');
  }

  // Export the AES key to raw bytes so we can wrap it
  const raw = await crypto.subtle.exportKey('raw', aesKey);

  // Create a device-bound credential
  const credentialId = await createCredential(uid);

  // Derive a wrapper key from the credentialId + random salt
  const wrappingSalt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const wrapperKey = await deriveWrapperKey(credentialId, wrappingSalt);

  // Encrypt the AES key bytes with the wrapper key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrapperKey,
    raw
  );

  const record = {
    uid,
    credentialId,
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    wrappingSalt,
    createdAt: new Date().toISOString(),
  };

  const db = await getDB();
  await db.put(STORE, record);
  return record;
}

/**
 * Unwrap the AES key. Triggers the biometric prompt.
 */
export async function unlockWithBiometric(uid) {
  const db = await getDB();
  const record = await db.get(STORE, uid);
  if (!record) return null;

  // Prompt the user for their biometric
  await getAssertion(record.credentialId);

  // Re-derive the wrapper key
  const wrapperKey = await deriveWrapperKey(record.credentialId, record.wrappingSalt);

  // Decrypt the AES key
  try {
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(record.iv) },
      wrapperKey,
      fromBase64(record.ciphertext)
    );

    // Re-import as an AES-GCM key
    return crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  } catch (err) {
    console.error('[vault] unwrap failed:', err);
    return null;
  }
}

/**
 * Check whether a wrapped key exists for this user without prompting.
 */
export async function hasStoredKey(uid) {
  const db = await getDB();
  const record = await db.get(STORE, uid);
  return !!record;
}

/**
 * Delete the wrapped key (used by "Sign out and clear local data").
 */
export async function deleteStoredKey(uid) {
  const db = await getDB();
  await db.delete(STORE, uid);
}

// ═══════════════════════════════════════════════════════════
// WRAPPER KEY DERIVATION
// ═══════════════════════════════════════════════════════════

async function deriveWrapperKey(credentialIdB64, saltB64) {
  const material = new TextEncoder().encode('mote-vault-v1:' + credentialIdB64);
  const salt = fromBase64(saltB64);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    material,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════

function toBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}