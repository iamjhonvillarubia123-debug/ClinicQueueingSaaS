# Database Governance

---

# Purpose

This document defines the database governance process for the Clinic Queueing SaaS project.

Its purpose is to ensure that all database changes are reviewed, documented, and approved before the production Prisma schema is modified.

The production database schema is considered a controlled engineering artifact.

---

# Core Principles

The database shall follow these principles.

- Business Rules Before Tables
- Review Before Migration
- Stable Production Schema
- One Source of Truth
- Small Incremental Changes
- Backward Compatibility where practical
- Clear Separation of Responsibilities

---

# Database Design Workflow

Every database change follows the same lifecycle.

```text
Business Requirement
        │
        ▼
Product Philosophy
        │
        ▼
Database Specification
        │
        ▼
Draft Prisma Model
        │
        ▼
Technical Review
        │
        ▼
Draft Updated
        │
        ▼
Review Approved
        │
        ▼
Production Prisma Schema
        │
        ▼
Migration
        │
        ▼
Testing
```

No stage may be skipped.

---

# Prisma Files

## Production Schema

```text
backend/prisma/schema.prisma
```

This file represents the production database design.

It must always remain in a valid and working state.

---

## Draft Models

```text
backend/prisma/drafts/
```

All proposed database changes must first be written as draft models.

Drafts may be edited freely during review.

---

## Reviews

```text
backend/prisma/reviews/
```

Every significant database change must have a corresponding review document.

---

## Decisions

```text
backend/prisma/decisions/
```

Architecture decisions affecting the database shall be recorded here.

---

# Source of Truth

Database authority follows this order.

1. Product Philosophy
2. Database Specification
3. Approved Review
4. Approved Draft
5. Production Prisma Schema
6. Migration
7. Database Instance

Higher levels override lower levels.

---

# Schema Modification Rules

The production schema may only be updated when:

- Draft review is approved.
- Related review document is completed.
- Implementation checklist permits schema update.

---

# Migration Rules

Every migration shall:

- Be generated from an approved schema.
- Have a meaningful migration name.
- Be reviewed before execution.
- Be tested before release.

Migrations must never contain unrelated schema changes.

---

# Model Design Rules

Each model should have one primary responsibility.

Avoid combining multiple business workflows into a single table.

Examples:

- BookingDraft
- Appointment
- Patient
- NotificationLog

Each represents a different business responsibility.

---

# Review Checklist

Before updating the production schema, verify:

- Product Philosophy approved.
- Specification approved.
- Draft completed.
- Review approved.
- Relationships reviewed.
- Indexes reviewed.
- Constraints reviewed.
- Business rules documented.

---

# Prohibited Practices

The following are not permitted.

- Editing schema.prisma before review approval.
- Creating migrations from incomplete drafts.
- Mixing temporary and permanent business data.
- Creating database fields without business justification.
- Renaming production fields without review.

---

# Success Criteria

A database change is complete only when:

- Draft approved.
- Review approved.
- Schema updated.
- Migration generated.
- Migration tested.
- Documentation updated.

---

# Related Documents

- 01 - Engineering Review Process.md
- 03 - Documentation Standards.md
- 04 - Decision Record Standard.md
- 05 - Review Template.md

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2026-08-02 | Initial Database Governance |