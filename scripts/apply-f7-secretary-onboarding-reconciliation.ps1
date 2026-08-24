$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$branch = (git branch --show-current).Trim()
if ($branch -ne 'f7-secretary-onboarding-reconciliation') {
    throw "Expected branch f7-secretary-onboarding-reconciliation, but current branch is '$branch'."
}

Write-Host '1/8 Applying deterministic SecretaryInvitation schema reconciliation...'
node scripts/reconcile-secretary-invitation-schema.mjs

Write-Host '2/8 Formatting and validating Prisma schema...'
npx prisma format
npm run prisma:validate

Write-Host '3/8 Regenerating Prisma Client...'
npm run prisma:generate

Write-Host '4/8 Applying pending repository migration to the configured local database...'
npx prisma migrate deploy

Write-Host '5/8 Running backend typecheck...'
npm run typecheck

Write-Host '6/8 Running focused Secretary invitation unit tests...'
npm test -- secretary-invitation.service.spec.ts --runInBand

Write-Host '7/8 Running backend build...'
npm run build

Write-Host '8/8 Running full frontend verification...'
Push-Location frontend
try {
    npm run verify
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Verification sequence completed. Current Git changes:'
git status --short
