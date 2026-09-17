// Stage 3 — Server-side ID generation.
//
// Rule: identifiers for accounts and references are ALWAYS generated here,
// on the backend, never accepted from a client. Nothing in this project
// should ever take an `id`/`userId`/`referenceId` value out of a request
// body and trust it.
//
// crypto.randomUUID() is part of Node's built-in `crypto` module (Node >=
// 14.17), so this has zero external dependencies and works fully offline.

const crypto = require('crypto');

const USER_ID_PREFIX = 'usr_';
const REFERENCE_ID_PREFIX = 'txn_';
// Stage 36 -- Central Audit Log entry ids. Same server-only,
// never-client-supplied rule as every other id in this file.
const AUDIT_LOG_ID_PREFIX = 'audit_';

function generateUserId() {
  return `${USER_ID_PREFIX}${crypto.randomUUID()}`;
}

function generateReferenceId() {
  return `${REFERENCE_ID_PREFIX}${crypto.randomUUID()}`;
}

function generateAuditLogId() {
  return `${AUDIT_LOG_ID_PREFIX}${crypto.randomUUID()}`;
}

function isUserId(value) {
  return typeof value === 'string' && value.startsWith(USER_ID_PREFIX);
}

function isReferenceId(value) {
  return typeof value === 'string' && value.startsWith(REFERENCE_ID_PREFIX);
}

module.exports = {
  USER_ID_PREFIX,
  REFERENCE_ID_PREFIX,
  AUDIT_LOG_ID_PREFIX,
  generateUserId,
  generateReferenceId,
  generateAuditLogId,
  isUserId,
  isReferenceId,
};
