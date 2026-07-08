// utils/validation.js — shared, strict validation for user-entered fields.
// Used server-side (the actual security boundary) by both signup and
// profile updates, so the rules can't be bypassed by calling the API directly.

// A real name: starts with a letter, 2-100 characters, only letters, spaces,
// apostrophes, and hyphens (covers names like "Kofi Mensah-Bonsu" or "D'Souza").
// Rejects things like "123", "asdf!!", or a single character.
const NAME_PATTERN = /^[A-Za-z][A-Za-z '-]{1,99}$/;

function isValidName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name.trim());
}

// A reasonably strict (not fully RFC 5322) email check: something@something.tld,
// no spaces, no consecutive dots. Good enough to reject "not an email" without
// rejecting legitimate real-world addresses.
const EMAIL_PATTERN = /^[^\s@.][^\s@]*@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_PATTERN.test(email.trim()) && !email.includes('..');
}

// Ghanaian mobile numbers: either local format (0XXXXXXXXX, 10 digits) or
// international format (+233XXXXXXXXX / 233XXXXXXXXX, 9 digits after 233).
function isValidGhanaPhone(phone) {
  if (typeof phone !== 'string') return false;
  const digits = phone.replace(/\D/g, '');
  return /^0\d{9}$/.test(digits) || /^233\d{9}$/.test(digits);
}

// At least 6 characters, and must contain both a letter and a number, purely
// "6 characters of anything" lets through things like "111111".
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;

function isValidPassword(password) {
  return typeof password === 'string' && PASSWORD_PATTERN.test(password);
}

module.exports = { isValidName, isValidEmail, isValidGhanaPhone, isValidPassword };
