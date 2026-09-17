# Stage 5 external activation checklist

1. Configure an approved SMS provider and wire its send endpoint/credentials without committing secrets.
2. Configure Google OAuth/OIDC credentials and production redirect/client settings.
3. Configure Facebook Login credentials and allowed domains/redirects.
4. Add a standards-compliant Apple Sign In JWT/JWKS signature verifier and Apple credentials.
5. ~~Persist identities/sessions/consents in the real database when the database connection is activated.~~
   **DONE (this session):** `db.auth` (`PostgresAuthRepository`) is now wired into
   `Backend/src/database/index.js`'s activation switch and passed to `AuthStore` in
   `Backend/src/index.js`, exactly like every other domain. `AuthStore`'s methods were made
   `async` to support this. What is still required to actually turn this on: a real
   `DATABASE_URL` + `STAGE3_ENABLE_POSTGRES=true` + `npm install` (adds `pg`) + running the
   migrations in a networked environment — none of which is available in this sandbox (see
   `STAGE_5_COMPLETION_REPORT.md`'s External Blockers section). Until then it correctly runs
   against the in-memory repository, same as every other domain.
6. Run the end-to-end provider tests on real devices before marking Stage 5 externally Done.
