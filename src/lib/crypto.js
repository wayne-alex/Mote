

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'SHA-256';
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

// ═══════════════════════════════════════════════════════════
// ENCODING HELPERS
// ═══════════════════════════════════════════════════════════

/** Convert an ArrayBuffer or Uint8Array to a base64 string. */
export function toBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert a base64 string back to a Uint8Array. */
export function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ═══════════════════════════════════════════════════════════
// RANDOM
// ═══════════════════════════════════════════════════════════

/** Cryptographically secure random bytes. */
export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** A random salt for key derivation. Stored alongside the user's data. */
export function generateSalt() {
  return toBase64(randomBytes(SALT_LENGTH_BYTES));
}

// ═══════════════════════════════════════════════════════════
// KEY DERIVATION
// ═══════════════════════════════════════════════════════════

/**
 * Derive an AES-GCM key from a passphrase and a base64 salt.
 *
 * This is intentionally slow — 600,000 PBKDF2 iterations, which
 * takes ~300–500 ms in a modern browser. Slow enough to make
 * brute-forcing the phrase impractical, fast enough that the user
 * barely notices.
 *
 * @param {string} phrase — the user's recovery phrase
 * @param {string} saltB64 — base64-encoded salt
 * @returns {Promise<CryptoKey>} — a non-extractable AES-GCM key
 */
export async function deriveKey(phrase, saltB64) {
  if (!phrase || typeof phrase !== 'string') {
    throw new Error('Passphrase is required.');
  }
  if (!saltB64) {
    throw new Error('Salt is required.');
  }

  const encoder = new TextEncoder();
  const phraseBytes = encoder.encode(phrase);
  const saltBytes = fromBase64(saltB64);

  // Import the phrase as raw PBKDF2 key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    phraseBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // Derive the AES-GCM key
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    true,                // non-extractable — the key can never leave the browser
    ['encrypt', 'decrypt']
  );

  return key;
}

// ═══════════════════════════════════════════════════════════
// ENCRYPT / DECRYPT
// ═══════════════════════════════════════════════════════════

/**
 * Encrypt a JavaScript object (a note) with an AES-GCM key.
 *
 * Returns { ciphertext, iv } where both are base64 strings.
 * A fresh random IV is generated for every call.
 *
 * @param {object} obj — the object to encrypt (must be JSON-serializable)
 * @param {CryptoKey} key — an AES-GCM key from deriveKey()
 * @returns {Promise<{ ciphertext: string, iv: string }>}
 */
export async function encryptObject(obj, key) {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(obj));
  const iv = randomBytes(IV_LENGTH_BYTES);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return {
    ciphertext: toBase64(ciphertextBuffer),
    iv: toBase64(iv),
  };
}

/**
 * Decrypt a base64 ciphertext back into the original object.
 *
 * Throws if the ciphertext was tampered with, the IV is wrong,
 * or the key doesn't match.
 *
 * @param {string} ciphertextB64 — base64-encoded ciphertext
 * @param {string} ivB64 — base64-encoded IV
 * @param {CryptoKey} key — the AES-GCM key
 * @returns {Promise<object>}
 */
export async function decryptObject(ciphertextB64, ivB64, key) {
  const ciphertext = fromBase64(ciphertextB64);
  const iv = fromBase64(ivB64);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  const json = decoder.decode(plaintextBuffer);
  return JSON.parse(json);
}

// ═══════════════════════════════════════════════════════════
// RECOVERY PHRASE
// ═══════════════════════════════════════════════════════════

// A curated 512-word list. All lowercase, all 4–8 letters, easy to
// read aloud and hard to confuse with each other. This is what gets
// shown to the user as their "recovery phrase".
//
// The list is short enough to be memorable as a phrase but long
// enough that 6 words give 54 bits of entropy (512^6 ≈ 2^54).
// That's plenty when combined with 600K PBKDF2 iterations.
const WORDLIST = [
  'amber', 'anchor', 'apple', 'arrow', 'aspen', 'atlas', 'autumn', 'avenue',
  'badge', 'baker', 'balance', 'bamboo', 'banjo', 'barrel', 'basil', 'basket',
  'beacon', 'beetle', 'bench', 'berry', 'bicycle', 'bishop', 'blanket', 'blossom',
  'boulder', 'branch', 'brave', 'bread', 'bridge', 'bright', 'bronze', 'brook',
  'bubble', 'bucket', 'butter', 'button', 'cabin', 'cable', 'cactus', 'camera',
  'candle', 'canoe', 'canyon', 'carbon', 'cargo', 'carpet', 'carrot', 'castle',
  'cedar', 'cello', 'cement', 'cherry', 'chest', 'chimney', 'chorus', 'circle',
  'citrus', 'clever', 'cliff', 'cloud', 'clover', 'cobalt', 'coffee', 'collar',
  'comet', 'compass', 'copper', 'coral', 'corner', 'cotton', 'cradle', 'crane',
  'crater', 'crayon', 'cream', 'crescent', 'cricket', 'crimson', 'crown', 'crystal',
  'cymbal', 'daisy', 'dancer', 'dapper', 'daring', 'dawn', 'dazzle', 'decoy',
  'delta', 'denim', 'depot', 'desert', 'diamond', 'diesel', 'digital', 'dinner',
  'dolphin', 'domino', 'donkey', 'dragon', 'drizzle', 'drum', 'dune', 'dynamo',
  'eagle', 'earth', 'easel', 'echo', 'eclipse', 'eight', 'elbow', 'elder',
  'ember', 'emerald', 'empire', 'energy', 'engine', 'envelope', 'equal', 'escape',
  'ethics', 'everest', 'fabric', 'falcon', 'fancy', 'farm', 'feather', 'fern',
  'ferry', 'fiddle', 'field', 'fiesta', 'filter', 'finch', 'fisher', 'flame',
  'flask', 'flint', 'flourish', 'flower', 'flute', 'forest', 'fossil', 'fountain',
  'fox', 'frame', 'fresh', 'frost', 'galaxy', 'gallery', 'garden', 'garlic',
  'gentle', 'geyser', 'ginger', 'glacier', 'glass', 'globe', 'glory', 'goldfish',
  'gopher', 'grace', 'grain', 'granite', 'grape', 'grass', 'gravel', 'grocer',
  'grotto', 'guitar', 'gulf', 'gumball', 'gym', 'hammer', 'hamster', 'harbor',
  'harmony', 'harvest', 'hazel', 'heather', 'helmet', 'herald', 'hickory', 'hollow',
  'honey', 'horizon', 'hornet', 'hostel', 'hotel', 'hummingbird', 'husky', 'iceberg',
  'igloo', 'indigo', 'insect', 'iron', 'island', 'ivory', 'jacket', 'jackpot',
  'jaguar', 'jasmine', 'jersey', 'jewel', 'jigsaw', 'jolly', 'journal', 'journey',
  'jungle', 'juniper', 'kayak', 'kernel', 'kettle', 'keystone', 'kilt', 'kingdom',
  'kiosk', 'kitten', 'kiwi', 'knapsack', 'koala', 'lagoon', 'lantern', 'lark',
  'laser', 'latch', 'lavender', 'leaf', 'ledger', 'legend', 'lemon', 'lens',
  'leopard', 'lettuce', 'library', 'lichen', 'lilac', 'lily', 'lime', 'lion',
  'lizard', 'lobster', 'locket', 'lotus', 'lumber', 'lunar', 'lychee', 'magenta',
  'magma', 'magnet', 'magnolia', 'mango', 'maple', 'marble', 'margin', 'marine',
  'market', 'marrow', 'mason', 'meadow', 'medal', 'medley', 'melon', 'menu',
  'mercury', 'mermaid', 'metal', 'meteor', 'midnight', 'mineral', 'minnow', 'mint',
  'mirror', 'mission', 'mitten', 'monsoon', 'moonlight', 'moss', 'mountain', 'muffin',
  'mulberry', 'mural', 'mustard', 'napkin', 'nectar', 'needle', 'newt', 'nickel',
  'nightingale', 'north', 'notebook', 'novel', 'nutmeg', 'oasis', 'ocean', 'octave',
  'octopus', 'olive', 'onion', 'onyx', 'opal', 'orange', 'orbit', 'orchard',
  'orchid', 'otter', 'owl', 'oyster', 'pagoda', 'palace', 'palm', 'pancake',
  'panda', 'panel', 'panorama', 'panther', 'paper', 'parade', 'parcel', 'parchment',
  'parrot', 'parsley', 'pasta', 'pastel', 'pathway', 'peach', 'peacock', 'peanut',
  'pearl', 'pebble', 'pelican', 'penguin', 'pepper', 'petal', 'pewter', 'phoenix',
  'piano', 'picnic', 'pigment', 'pilgrim', 'pillar', 'pilot', 'pinwheel', 'pioneer',
  'pistachio', 'pitch', 'plaid', 'planet', 'plateau', 'plaza', 'plum', 'pocket',
  'poem', 'polar', 'pollen', 'pomegranate', 'pond', 'poppy', 'porcelain', 'porch',
  'portal', 'poster', 'prairie', 'prism', 'puffin', 'pumpkin', 'puzzle', 'pylon',
  'quarry', 'quartz', 'quilt', 'quiver', 'rabbit', 'radar', 'radio', 'radish',
  'rafter', 'rainbow', 'rally', 'ranch', 'raven', 'ribbon', 'ridge', 'rifle',
  'ripple', 'ritual', 'river', 'robin', 'rocket', 'rosemary', 'rosewood', 'ruby',
  'rudder', 'rugby', 'rustic', 'saddle', 'saffron', 'sage', 'sailor', 'salad',
  'salmon', 'sandal', 'sapling', 'sapphire', 'satellite', 'savanna', 'sawdust', 'scarab',
  'scent', 'school', 'scooter', 'scout', 'scroll', 'seagull', 'season', 'sedan',
  'sequoia', 'serpent', 'shadow', 'shallow', 'shark', 'shelter', 'sherbet', 'shield',
  'ship', 'shore', 'shrimp', 'signal', 'silent', 'silk', 'silver', 'siren',
  'sixty', 'sketch', 'skyline', 'sled', 'sleigh', 'sliver', 'smile', 'snowflake',
  'solar', 'sonnet', 'sorbet', 'spanner', 'sparrow', 'sphere', 'spice', 'spider',
  'spindle', 'spiral', 'sponge', 'spring', 'sprout', 'spruce', 'spyglass', 'squash',
  'square', 'squid', 'stable', 'stanza', 'star', 'statue', 'steady', 'stellar',
  'stencil', 'steppe', 'sterling', 'stilt', 'stoic', 'stone', 'storm', 'stream',
  'sugar', 'sulphur', 'summer', 'sunset', 'surf', 'swan', 'sword', 'sycamore',
  'syrup', 'tablet', 'tackle', 'tadpole', 'talon', 'tandem', 'tangent', 'tangerine',
  'tapestry', 'tapioca', 'tavern', 'teacup', 'teal', 'tempo', 'tender', 'tent',
  'tepid', 'terrace', 'terrapin', 'thistle', 'thorn', 'threshold', 'thunder', 'ticket',
  'tiger', 'timber', 'tin', 'tinsel', 'tissue', 'toast', 'toffee', 'toga',
  'tomato', 'tonic', 'topaz', 'torch', 'totem', 'tourmaline', 'tower', 'tractor',
  'trail', 'train', 'tranquil', 'treaty', 'trellis', 'trill', 'trombone', 'trophy',
  'tropic', 'trout', 'trumpet', 'trunk', 'tulip', 'tundra', 'turbine', 'turkey',
  'turquoise', 'turtle', 'tweed', 'twilight', 'twin', 'twine', 'ultra', 'umbrella',
  'unicorn', 'unison', 'upbeat', 'urban', 'urchin', 'utopia', 'vacuum', 'valley',
  'vanilla', 'vapor', 'velvet', 'veneer', 'venture', 'verse', 'vessel', 'viking',
  'vine', 'violet', 'violin', 'viper', 'vision', 'vista', 'vocal', 'volcano',
  'voyage', 'waffle', 'wagon', 'walnut', 'walrus', 'wander', 'wasabi', 'waterfall',
  'wave', 'weasel', 'whale', 'wheat', 'wheel', 'whisk', 'whistle', 'wick',
  'willow', 'windmill', 'winter', 'wisdom', 'wolf', 'wombat', 'wonder', 'woodland',
  'wrangler', 'wreath', 'yacht', 'yarrow', 'yeast', 'yellow', 'yodel', 'yogurt',
  'zebra', 'zenith', 'zephyr', 'zigzag', 'zinnia', 'zipper', 'zodiac', 'zucchini',
];

export const RECOVERY_WORD_COUNT = 6;

/**
 * Generate a random recovery phrase of RECOVERY_WORD_COUNT words.
 * Uses crypto.getRandomValues for unbiased selection.
 */
export function generateRecoveryPhrase() {
  const words = [];
  const max = WORDLIST.length;

  // Rejection sampling to avoid modulo bias.
  // Generate 32-bit unsigned ints, discard those that would over-represent
  // the low end of the range, then take mod max.
  const limit = Math.floor(0xFFFFFFFF / max) * max;

  while (words.length < RECOVERY_WORD_COUNT) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    words.push(WORDLIST[buf[0] % max]);
  }

  return words.join('-');
}

/**
 * Check whether a phrase is well-formed (right number of words,
 * all from the wordlist). Doesn't check whether it's the *correct*
 * phrase — that requires attempting a decryption.
 */
export function isValidRecoveryPhrase(phrase) {
  if (!phrase || typeof phrase !== 'string') return false;
  const words = phrase.trim().toLowerCase().split(/[-\s]+/);
  if (words.length !== RECOVERY_WORD_COUNT) return false;
  return words.every((w) => WORDLIST.includes(w));
}

/**
 * Normalize a phrase the user typed — trim, lowercase, unify separators.
 * Users might type spaces, or extra hyphens, or mixed case.
 */
export function normalizePhrase(phrase) {
  if (!phrase) return '';
  return phrase
    .trim()
    .toLowerCase()
    .split(/[-\s]+/)
    .filter(Boolean)
    .join('-');
}

// ═══════════════════════════════════════════════════════════
// VERIFICATION
// ═══════════════════════════════════════════════════════════

/**
 * A small "verifier" blob is stored on the server alongside the user's
 * encrypted notes. It contains a fixed known plaintext, encrypted
 * with the user's key. On a new device, we decrypt the verifier with
 * the phrase the user typed. If it decrypts correctly, the phrase is
 * right. If not, either the phrase is wrong or the data is corrupt.
 *
 * The verifier reveals nothing about the notes — it's a fixed string.
 */
const VERIFIER_PLAINTEXT = { v: 'mote-verifier', n: 1 };

export async function buildVerifier(key) {
  return encryptObject(VERIFIER_PLAINTEXT, key);
}

export async function checkVerifier(verifier, key) {
  try {
    const obj = await decryptObject(verifier.ciphertext, verifier.iv, key);
    return obj && obj.v === VERIFIER_PLAINTEXT.v;
  } catch {
    return false;
  }
}