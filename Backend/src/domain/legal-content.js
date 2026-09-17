// Stage 34 — Terms and Help static content.
//
// There is no CMS anywhere in this repository (confirmed: no content
// table, no admin editor, no route that writes copy). Per the explicit
// instruction not to invent a database-backed content system just to
// satisfy two checklist items, this file is real, deterministic,
// server-served static content -- plain constants, versioned by hand,
// exactly like ../config/config.schema.js's DEFAULT_CONFIG is static
// data owned by code rather than a database row. ../services/
// settings.service.js's getTerms()/getHelp() return these objects
// unchanged; nothing here is ever mutated at runtime.
//
// If a future stage needs Terms/Help to be editable without a
// deployment, that is a genuinely new content-management subsystem --
// out of Stage 34's scope, and not invented here.

const TERMS_CONTENT = Object.freeze({
  version: '1.0',
  updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Terms of Service',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Acceptance of Terms',
      body: 'By creating an account and using this app, you agree to these Terms of Service and to the Privacy settings you configure in your account.',
    }),
    Object.freeze({
      heading: 'Accounts',
      body: 'You are responsible for the activity on your account. You may delete your account at any time from Settings; deletion deactivates your account and signs you out of all devices.',
    }),
    Object.freeze({
      heading: 'Conduct',
      body: 'Harassment, abuse, and violations reported through the in-app Report feature are reviewed under the platform moderation policy.',
    }),
    Object.freeze({
      heading: 'Changes',
      body: 'These terms may be updated from time to time; the version and date above reflect the copy currently in effect.',
    }),
  ]),
});

const HELP_CONTENT = Object.freeze({
  version: '1.0',
  updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Help',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Account & Login',
      body: 'Manage phone/social login, password recovery, and active devices from Settings > Account and Settings > Devices.',
    }),
    Object.freeze({
      heading: 'Privacy & Notifications',
      body: 'Control who can see your profile from Settings > Privacy, and which notification categories you receive from Settings > Notifications.',
    }),
    Object.freeze({
      heading: 'Blocking & Reporting',
      body: 'Block a user from their profile, or report a user or piece of content from Settings > Report. Reports are reviewed by moderation.',
    }),
    Object.freeze({
      heading: 'Deleting your account',
      body: 'Settings > Delete Account deactivates your account and signs you out everywhere. Contact support if you need help before deleting.',
    }),
  ]),
});

// Stage 35 Part 8/8 -- Customer Support FAQ.
//
// Same reasoning as TERMS_CONTENT/HELP_CONTENT directly above: no CMS
// anywhere in this repository, so this is real, deterministic,
// server-served static content -- not a database-backed content system
// invented just for this checklist item. Distinct from HELP_CONTENT
// (Settings > Help, Stage 34, general how-to-use-the-app copy): FAQ is
// specifically the Customer Support entry point (Stage 35 Part 8),
// answering the questions a support ticket would otherwise be filed for.
const FAQ_CONTENT = Object.freeze({
  version: '1.0',
  updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Frequently Asked Questions',
  items: Object.freeze([
    Object.freeze({
      question: 'How do I open a support ticket?',
      answer: 'Go to Settings > Support and choose a ticket type (Account, Billing, Technical, Room, or Gift/Wallet), then describe your issue. You can attach a screenshot link to your ticket.',
    }),
    Object.freeze({
      question: 'How long does it take to get a reply?',
      answer: 'A staff member replies on your ticket once it is picked up. You can check its status (open, in progress, waiting on you, resolved, or closed) at any time from your ticket list.',
    }),
    Object.freeze({
      question: 'My issue was not resolved -- what can I do?',
      answer: 'If a ticket is not resolved to your satisfaction, staff can escalate it for further review. You will see the escalation reflected in the ticket status.',
    }),
    Object.freeze({
      question: 'I was banned/muted/reported -- is that different from a support ticket?',
      answer: 'Yes. Reports and moderation decisions are handled under Moderation, with their own appeal process. Use a support ticket for account, billing, technical, room, or gift/wallet issues instead.',
    }),
    Object.freeze({
      question: 'Can I see my past tickets?',
      answer: 'Yes, your ticket history -- including type, status, staff replies, and any escalation -- is always available to you under Settings > Support.',
    }),
  ]),
});

module.exports = { TERMS_CONTENT, HELP_CONTENT, FAQ_CONTENT };
