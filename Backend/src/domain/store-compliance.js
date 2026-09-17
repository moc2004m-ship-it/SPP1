'use strict';

const STORE_COMPLIANCE = Object.freeze({
  version: '1.0',
  updatedAt: '2026-09-17T00:00:00.000Z',
  ageRating: { minimumAge: 13, rationale: 'User-generated content, private messaging, social interaction, virtual currency, and competitive games are present.' },
  ugcPolicy: { title: 'User Generated Content Policy', body: 'Users must not post illegal, abusive, hateful, sexually explicit, fraudulent, or privacy-invasive content. Reports, blocking, moderation review, appeals, and support are available in-app.' },
  dataProtection: { title: 'Data Protection Statement', body: 'The service processes account, authentication, session, social, room, game, wallet, recharge, gift, notification, and support data needed to operate the service. Access is permission-controlled and sensitive staff actions are audit logged.' },
});
module.exports = { STORE_COMPLIANCE };
