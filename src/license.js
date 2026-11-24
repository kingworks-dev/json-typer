'use strict';
// Offline Pro key check. Keys look like JTYP-XXXX-XXXX-CCCC where CCCC is a checksum of the first two groups.
// Honor-system licensing: the check runs on the user's machine and nothing is sent anywhere.
const crypto = require('crypto');
const PREFIX = 'JTYP';
function check(g1, g2) {
  return crypto.createHash('sha256').update(PREFIX + g1 + g2 + 'KAI').digest('hex').toUpperCase().slice(0, 4);
}
function validKey(k) {
  const m = /^JTYP-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})$/.exec(String(k || '').trim().toUpperCase());
  if (!m) return false;
  return check(m[1], m[2]) === m[3];
}
function makeKey(g1, g2) {
  return `${PREFIX}-${g1}-${g2}-${check(g1, g2)}`;
}
module.exports = { validKey, makeKey };
