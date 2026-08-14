$ErrorActionPreference = 'Stop'

Write-Host 'Clinic Queueing SaaS - Milestone 0 local verification'
Write-Host 'This script does not reset or delete any database.'

Write-Host "`n[1/6] Node and npm"
node --version
npm --version

Write-Host "`n[2/6] Clean dependency install"
npm ci

Write-Host "`n[3/6] Prisma validation and client generation"
npm run prisma:validate
npm run prisma:generate

Write-Host "`n[4/6] Typecheck, lint, unit tests, e2e tests, build"
npm run typecheck
npx eslint "{src,apps,libs,test}/**/*.ts"
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build

Write-Host "`n[5/6] Database configuration presence"
if (-not $env:DATABASE_URL) {
  Write-Host 'DATABASE_URL is not set in this terminal. Database connectivity was NOT tested.' -ForegroundColor Yellow
} else {
  Write-Host 'DATABASE_URL is set. Running non-destructive Prisma migration status.'
  npx prisma migrate status
}

Write-Host "`n[6/6] Result"
Write-Host 'Milestone 0 local verification commands completed.' -ForegroundColor Green
