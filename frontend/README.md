# Clinic Queueing Frontend

Version 1 frontend foundation.

## Local development

1. Copy `.env.example` to `.env.local` and set only browser-safe values.
2. Run `npm install`.
3. Run `npm run dev`.

The backend defaults to `http://localhost:3000` and the frontend to `http://localhost:5173`. Configure the backend `WEB_APP_ORIGIN` accordingly so credentialed HttpOnly session cookies are accepted.

## Verification

Run `npm run verify` to execute TypeScript type checking, ESLint, unit tests, and the production build.

Never place passwords, API keys, provider tokens, session tokens, patient data, or other secrets in `VITE_*` environment variables because those values are exposed to the browser bundle.
