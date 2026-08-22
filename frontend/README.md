# Clinic Queueing Frontend

React + Vite frontend for the Clinic Queueing SaaS.

## Local development

The backend runs at `http://localhost:3000` and the frontend at `http://localhost:5173` by default.

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Browser authentication uses the backend's HttpOnly session cookie. Never place secrets in `VITE_*` variables.

## Public routes

F1 uses the backend's immutable public identifiers directly as stable route identity:

- `/public/doctors/:publicIdentifier`
- `/public/practice-locations/:publicIdentifier`
- `/book/:practiceLocationPublicIdentifier` is the frontend handoff boundary into F2 individual booking.

Public pages render only fields returned by the privacy-whitelisted backend public-routing API. Frontend availability display is not authority: the backend remains authoritative for lifecycle, subscription, schedule, capacity, and booking eligibility.

## Verification

```powershell
npm run verify
```

This runs typecheck, lint, unit tests, and the production build.
