# Stage 5 — Authentication / Sessions / Recovery

## Implemented in project files
- Phone OTP challenge generation, hashing, expiry and attempt limit.
- Configurable real SMS delivery boundary; production fails closed when SMS is not configured (no fake success).
- OTP registration/login creates accounts through the Stage 3 server-owned account repository.
- Consent version + acceptance timestamp are stored server-side during registration/login.
- Random bearer sessions with hashed token storage, device metadata, listing, logout and remote session revocation.
- Recovery OTP request + verification creates a new authenticated session for the verified phone.
- Google and Facebook provider-issued token verification via provider user-info endpoints.
- Apple endpoint fails closed until a real signature/JWKS verifier is configured; it never trusts an unsigned client payload.
- Auth screen for phone/OTP flow.
- API/security documentation and automated route tests added.

## Verification
- JavaScript syntax checks pass for all new auth modules/routes.
- Stage 3/4 non-HTTP unit tests remain runnable in the existing environment.
- Full HTTP route execution is blocked in this environment because the project's npm dependencies (including Express) are not installed locally and network/package installation is unavailable. This is recorded, not hidden.

## External activation still required
- Real SMS provider credentials/endpoint.
- Production Google/Facebook credentials and provider configuration.
- A standards-compliant Apple Sign In JWT signature/JWKS verifier and credentials.
- Persistent DB tables for identities/sessions/consents when the real Postgres connection is activated.

## Definition-of-Done
**Stage 5 code is implemented, but Stage 5 is NOT declared externally Done until the real provider integrations and HTTP/device tests are executed.**
