# Stage 5 API contract

- `POST /auth/otp/request` `{phone}` → `202 {status, expiresInSeconds}`
- `POST /auth/otp/verify` `{phone, code, consentVersion, device}` → session + server account
- `POST /auth/social/google|facebook|apple` `{accessToken, consentVersion, device}` → session + server account
- `GET /auth/me` bearer → account + stored consent
- `GET /auth/sessions` bearer → active sessions for current account
- `DELETE /auth/sessions/:sessionId` bearer → remote revocation
- `POST /auth/recovery/otp/request` `{phone}` → OTP challenge
- `POST /auth/logout` bearer → current session revocation
