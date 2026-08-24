$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$branch = (git branch --show-current).Trim()
if ($branch -ne 'f7-secretary-onboarding-reconciliation') {
    throw "Expected branch f7-secretary-onboarding-reconciliation, but current branch is '$branch'."
}

Write-Host '1/11 Applying deterministic SecretaryInvitation schema reconciliation...'
node scripts/reconcile-secretary-invitation-schema.mjs

Write-Host '2/11 Applying Secretary access-profile schema reconciliation...'
node scripts/reconcile-secretary-access-schema.mjs

Write-Host '3/11 Applying protected replacement-candidate schema reconciliation...'
node scripts/reconcile-secretary-replacement-schema.mjs

Write-Host '4/11 Applying Secretary clinic-details proposal schema reconciliation...'
node scripts/reconcile-secretary-clinic-details-schema.mjs

Write-Host '5/11 Formatting and validating Prisma schema...'
npx prisma format
npm run prisma:validate

Write-Host '6/11 Regenerating Prisma Client...'
npm run prisma:generate

Write-Host '7/11 Applying pending repository migrations to the configured local database...'
npx prisma migrate deploy

Write-Host '8/11 Running backend typecheck...'
npm run typecheck

Write-Host '9/11 Running focused Secretary onboarding/access/proposal unit tests...'
npm test -- secretary-invitation.service.spec.ts secretary-replacement-invitation.service.spec.ts practice-staff-read.service.spec.ts practice-staff-access.service.spec.ts secretary-settings-draft-access.service.spec.ts secretary-settings-draft-clinic-details.service.spec.ts secretary-settings-draft-approval.service.spec.ts --runInBand

Write-Host '10/11 Running backend build...'
npm run build

Write-Host '11/11 Running full frontend verification...'
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
