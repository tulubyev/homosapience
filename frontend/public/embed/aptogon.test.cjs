const assert = require('assert');
const { buildSignerUrl, isValidMessage } = require('./v1/aptogon.js');

// buildSignerUrl
const url = buildSignerUrl('https://homosapience.org', 'pk_live_x', 'https://site.com');
assert.strictEqual(
  url,
  'https://homosapience.org/embed/signer?pk=pk_live_x&origin=https%3A%2F%2Fsite.com&v=1',
  'buildSignerUrl should encode params'
);
assert.strictEqual(
  buildSignerUrl('https://homosapience.org/', 'k', 'o'),
  'https://homosapience.org/embed/signer?pk=k&origin=o&v=1',
  'buildSignerUrl should strip trailing slash'
);

// isValidMessage
const popup = {};
const good = { origin: 'https://homosapience.org', source: popup, data: { type: 'aptogon:result', token: 't' } };
assert.strictEqual(isValidMessage(good, 'https://homosapience.org', popup), true, 'valid message accepted');
assert.strictEqual(isValidMessage({ ...good, origin: 'https://evil.com' }, 'https://homosapience.org', popup), false, 'wrong origin rejected');
assert.strictEqual(isValidMessage({ ...good, source: {} }, 'https://homosapience.org', popup), false, 'wrong source rejected');
assert.strictEqual(isValidMessage({ origin: 'https://homosapience.org', source: popup, data: { type: 'other' } }, 'https://homosapience.org', popup), false, 'wrong type rejected');

console.log('aptogon.js helper tests: PASS');
