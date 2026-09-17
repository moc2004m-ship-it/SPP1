# Stage 5 security notes

- OTP values are hashed before storage.
- OTP expires after five minutes and is limited to five verification attempts.
- Session bearer tokens are random and only their SHA-256 hashes are retained in memory.
- Social login trusts only provider-verified identity responses; a client cannot choose a provider subject.
- Consent is versioned and timestamped server-side.
- Production must not enable `AUTH_EXPOSE_TEST_OTP`.
- Secrets and provider credentials are intentionally absent from source control.
