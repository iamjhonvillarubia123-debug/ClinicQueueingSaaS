# ADR-0002: Mobile Number Security

## Status

Draft

---

## Date

2026-08-05

---

## Problem

The Clinic Queueing SaaS must store patient mobile numbers for OTP
verification, booking management, patient matching, and notifications.

Plain-text mobile numbers must not be stored.

The application requires both:

1. Reversible protection for authorized notification and operational use.
2. Deterministic protected lookup for duplicate detection and matching.

The implementation must also detect ciphertext tampering and allow future
key rotation without rewriting the database structure.

---

## Context

Mobile numbers are sensitive patient data.

Before protection, every accepted Philippine mobile number must be normalized
into one canonical representation.

Example canonical representation:

639171234567

The same canonical value must be used for:

- encryption;
- deterministic lookup hashing;
- last-four extraction.

The database stores:

- mobileNumberEncrypted;
- mobileNumberHash;
- mobileNumberLastFour.

The canonical plain-text number must not be written to:

- PostgreSQL;
- application logs;
- error messages;
- analytics;
- audit metadata;
- source code.

Encryption and lookup hashing serve different purposes and must use separate
keys.

---

## Options Considered

### Option A: Plain-text storage

Advantages

- Simple implementation.
- Direct searching and notification use.

Disadvantages

- Violates the approved privacy design.
- Exposes all mobile numbers if the database is accessed.
- Not acceptable.

---

### Option B: One-way hash only

Advantages

- Supports deterministic lookup.
- Original mobile number cannot be recovered from the stored hash alone.

Disadvantages

- Cannot provide the number to authorized notification services.
- Does not satisfy operational recovery requirements.
- Mobile numbers have a small searchable domain, so an unkeyed ordinary hash
  is vulnerable to enumeration.

---

### Option C: Encryption only

Advantages

- Authorized application code can recover the mobile number.
- Protects the plain-text value at rest.

Disadvantages

- Randomized encryption cannot provide stable equality lookup.
- Deterministic encryption would reveal equality patterns and increases
  cryptographic risk.
- Does not independently support indexed duplicate detection.

---

### Option D: Authenticated encryption plus keyed deterministic hashing

Advantages

- Authenticated encryption supports authorized recovery and detects tampering.
- Keyed deterministic hashing supports indexed equality lookup.
- Separate keys isolate the two cryptographic purposes.
- Versioned storage supports future key rotation.
- No plain-text mobile number is stored.

Disadvantages

- Requires secure management of two independent secrets.
- Requires careful ciphertext formatting and validation.
- Key rotation requires an operational migration process.
- Exact mobile-number searches reveal equality through the hash column, which
  is necessary for the approved matching workflow.

---

## Decision

Use Option D.

### 1. Canonical normalization

Before encryption or hashing:

1. Trim surrounding whitespace.
2. Remove accepted visual separators such as spaces and hyphens.
3. Convert supported Philippine formats to the canonical country-code form.
4. Validate the canonical value against the approved Philippine mobile-number
   rules.
5. Reject invalid or ambiguous input.

Canonical example:

639171234567

Normalization must be implemented in one shared service and tested
independently.

### 2. Encryption

Use AES-256-GCM through the Node.js crypto module.

For each encryption operation:

- use a 32-byte encryption key;
- generate a new cryptographically random 12-byte IV;
- use a 16-byte authentication tag;
- never reuse an IV with the same encryption key.

Store a versioned envelope containing:

- format version;
- encryption key identifier;
- IV;
- authentication tag;
- ciphertext.

Proposed Version 1 format:

v1.<keyId>.<ivBase64Url>.<tagBase64Url>.<ciphertextBase64Url>

The entire envelope is stored in mobileNumberEncrypted.

Decryption must fail closed when:

- the envelope format is invalid;
- the key identifier is unknown;
- authentication fails;
- the decrypted value is not a valid canonical mobile number.

### 3. Deterministic lookup hashing

Use HMAC-SHA-256 over the canonical mobile number.

Conceptual input:

HMAC-SHA-256(lookupKey, canonicalMobileNumber)

Encode the resulting digest as lowercase hexadecimal.

The lookup key must:

- be different from the encryption key;
- be loaded from protected configuration;
- never be stored in the database;
- never be logged;
- support an identifiable version for future rotation.

For Version 1, mobileNumberHash contains only the lowercase hexadecimal digest.
The active lookup-key version is application configuration.

A future rotation that changes the lookup key will require recalculation of
stored lookup hashes through a reviewed migration process.

### 4. Last four digits

mobileNumberLastFour is derived from the final four digits of the canonical
mobile number.

It is display-only and must not be treated as an authentication factor or
unique identifier.

### 5. Configuration

Use these environment-variable names:

MOBILE_ENCRYPTION_KEY_V1
MOBILE_ENCRYPTION_ACTIVE_KEY_ID
MOBILE_LOOKUP_HMAC_KEY_V1
MOBILE_LOOKUP_ACTIVE_KEY_ID

Key material must be encoded as Base64.

At application startup:

- decode each configured key;
- verify the encryption key is exactly 32 bytes;
- require both active key identifiers;
- reject missing, malformed, or incorrectly sized secrets;
- never print secret values in errors or logs.

Development secrets may be stored in the ignored local .env file.

Production secrets must be supplied by a managed secret store or protected
deployment environment rather than committed files.

### 6. Application structure

Create one security infrastructure module:

src/security/mobile-number/

Planned files:

- mobile-number.module.ts
- mobile-number.service.ts
- mobile-number-normalizer.ts
- mobile-number.service.spec.ts
- mobile-number-normalizer.spec.ts

The service will expose narrowly scoped operations such as:

- normalize(input)
- protect(input)
- encryptCanonical(canonical)
- decrypt(envelope)
- hashCanonical(canonical)
- getLastFour(canonical)

Feature services must not call Node crypto functions directly.

### 7. Authorization boundary

Only backend services with an approved operational need may decrypt a mobile
number.

Controllers must not expose decrypted mobile numbers by default.

List and search responses should use masked or last-four representations unless
a separately approved workflow requires the full number.

### 8. Logging and errors

Never log:

- raw input mobile numbers;
- canonical mobile numbers;
- decrypted mobile numbers;
- encryption keys;
- HMAC keys;
- complete ciphertext envelopes;
- complete lookup hashes.

Errors returned to clients must not reveal cryptographic internals.

Authentication-tag failures and malformed ciphertext should produce a generic
internal security error and an appropriately redacted operational log event.

### 9. Testing

Unit tests must cover:

- each accepted Philippine input format;
- invalid formats;
- deterministic normalization;
- deterministic HMAC output for the same key and canonical value;
- different HMAC output for different canonical values;
- different ciphertext for repeated encryption of the same canonical value;
- successful encrypt/decrypt round trip;
- rejection of modified IV, tag, or ciphertext;
- rejection of unknown key identifiers;
- rejection of missing or malformed configuration;
- correct last-four extraction;
- assurance that tests do not print secret or plain-text values.

Use dedicated non-production test keys.

---

## Consequences

Positive consequences:

- Plain-text mobile numbers are not stored.
- Authorized recovery remains possible.
- Database lookup and duplicate detection remain efficient.
- Ciphertext tampering is detected.
- Cryptographic logic is centralized and testable.
- Versioned envelopes provide a path for encryption-key rotation.

Negative consequences:

- Two independent secrets must be protected.
- Application startup becomes dependent on valid security configuration.
- Lookup-key rotation requires recalculating stored hashes.
- Decryption access must be carefully controlled.
- Operational procedures for rotation and incident response must be documented
  before production deployment.

---

## Related Specifications

- 08 - Patient Table
- 10A - Booking Draft Table
- 11 - OTP Verification Table
- 15 - Notification Log Table
- 16 - Patient Workflow Specification
- 17 - Patient Business Rules
- 18 - Patient Data Retention Policy
- ADR-0001 - BookingDraft

---

## Notes

This ADR does not approve:

- deterministic encryption;
- unkeyed SHA-256 lookup hashes;
- Base64 as encryption;
- storing canonical mobile numbers in logs or temporary database columns;
- using one key for both encryption and lookup hashing;
- production secrets stored in committed environment files.

Before changing algorithms, envelope format, key sizes, or key-rotation
behavior, create a superseding ADR and review the migration impact.