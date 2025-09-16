// Strong phone parsing/validation with libphonenumber-js
const { parsePhoneNumberFromString } = require('libphonenumber-js')

/**
 * Normalize any plausible input to E.164 (+<countrycode><nsn>)
 * @param {string} raw - user input
 * @param {string} defaultCountry - e.g. 'GR' for Greece
 * @returns {{ ok: boolean, e164?: string, reason?: string }}
 */
function normalizeToE164(raw, defaultCountry = 'GR') {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, reason: 'empty' }
  }
  const trimmed = raw.trim()
  const phone = parsePhoneNumberFromString(trimmed, defaultCountry)
  if (!phone) return { ok: false, reason: 'unparsable' }
  if (!phone.isPossible()) return { ok: false, reason: 'impossible' }
  if (!phone.isValid()) return { ok: false, reason: 'invalid' }
  return { ok: true, e164: phone.number } // E.164
}

/**
 * Quick check for already-normalized E.164 strings.
 */
function isE164(v) {
  return typeof v === 'string' && /^\+[1-9]\d{6,14}$/.test(v)
}

module.exports = { normalizeToE164, isE164 }
