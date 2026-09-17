'use strict';

// Stage 36 — Audit service. Thin, deliberate layer over
// ../database/repositories/audit-log.repository.js:
//   - record(): called by OTHER admin services (account-admin.service.js,
//     inventory-admin.service.js, and future Stage 36 admin services) as
//     the last step of a sensitive action that has ALREADY been
//     authorized by that service. This function does not itself check
//     staff permissions for the action being recorded -- the caller
//     already did, exactly once, before performing the action; recording
//     it a second gated check would just be redundant and could let a
//     recording failure be confused with an authorization failure.
//   - list(): the one path the Stage 36 admin panel's audit view uses to
//     READ the log, and this one DOES gate on
//     ../security/staff.js's AUDIT_VIEW permission -- an admin action
//     being recorded is not the same permission as being allowed to
//     browse everyone else's admin actions.
//
// record() never throws on its own account -- a failure to persist an
// audit entry must never be allowed to look like, or cause, the failure
// of the real action it is describing (same "never let a side-effect
// throw and be mistaken for the primary operation's own failure"
// discipline as ../services/notification.service.js's notify()). The
// caller still awaits it (so a genuine bug surfaces in tests/logs) but
// nothing upstream of audit.service.js needs a try/catch around it.

const { hasPermission, PERMISSIONS } = require('../security/staff');

function createAuditService({ auditLog, staffRoles, logger }) {
  async function record({ actorId, action, targetType, targetId, reason, metadata }) {
    try {
      return await auditLog.record({ actorId, action, targetType, targetId, reason, metadata });
    } catch (err) {
      // Logged, never rethrown -- see header. A missing/malformed field
      // here is a bug in the CALLING service (it should have passed
      // valid actorId/action/targetType/targetId), so it is surfaced
      // loudly in logs, but it must never turn a successful suspend/
      // grant/etc. into a 500 for the admin who just performed it.
      if (logger && typeof logger.error === 'function') {
        logger.error({ err, action, targetType, targetId }, 'audit log record failed');
      }
      return null;
    }
  }

  // Gated read: only a staff member with AUDIT_VIEW may browse the log.
  async function list({ actorId, ...filters }) {
    if (!hasPermission(staffRoles, actorId, PERMISSIONS.AUDIT_VIEW)) {
      throw Object.assign(new Error('audit:view permission required'), { status: 403 });
    }
    return auditLog.list(filters);
  }

  return { record, list };
}

module.exports = { createAuditService };
