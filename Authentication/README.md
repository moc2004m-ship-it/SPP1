# Stage 5 Authentication

The backend owns identity creation, consent, sessions, and authentication decisions. Development tests may expose an OTP only when `NODE_ENV=test` or `AUTH_EXPOSE_TEST_OTP=true`; production responses never return the OTP.
