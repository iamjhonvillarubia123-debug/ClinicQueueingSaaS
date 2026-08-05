# Engineering Review Process

---

# Purpose

This document defines the official engineering workflow used throughout the Clinic Queueing SaaS project.

Every major feature, module, database change, and business workflow shall follow this process before implementation.

The objective is to ensure that engineering decisions are reviewed, documented, and approved before production code is modified.

---

# Guiding Principles

The engineering process follows these principles.

- Business rules before code.
- Review before implementation.
- One Source of Truth.
- Small vertical slices.
- Stable production schema.
- Documentation drives implementation.
- Approved decisions are implemented only once.

---

# Engineering Lifecycle

Every feature follows the same lifecycle.

```text
Idea
    │
    ▼
Product Philosophy
    │
    ▼
Specification
    │
    ▼
Draft
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
Production Schema Updated
    │
    ▼
Database Migration
    │
    ▼
Backend Implementation
    │
    ▼
Frontend Implementation
    │
    ▼
Testing
    │
    ▼
Production Release
```

No stage may be skipped.

---

# Stage Descriptions

## 1. Product Philosophy

Defines **why** the feature exists.

No technical implementation is discussed here.

---

## 2. Specification

Defines the business rules.

Examples:

- Workflow
- Validation
- User behaviour
- Edge cases

---

## 3. Draft

The proposed implementation.

Examples:

- Prisma draft
- API draft
- UI draft

Drafts may change frequently.

Production code must not be modified during this stage.

---

## 4. Technical Review

Every draft must undergo review.

The review should answer:

- Is the business rule correct?
- Is the database correct?
- Is the design simple?
- Are responsibilities separated?
- Does it match the Product Philosophy?

---

## 5. Draft Updated

The draft is revised using the approved review decisions.

---

## 6. Review Approved

The review becomes the official engineering decision.

Implementation may begin only after approval.

---

## 7. Production Schema

The production Prisma schema is updated.

Only approved drafts may be copied into the production schema.

---

## 8. Database Migration

Generate and verify the migration.

Migration must not introduce unintended schema changes.

---

## 9. Backend

Implement backend logic.

Implementation must follow the approved review.

---

## 10. Frontend

Implement user interface.

The frontend must follow the approved backend contracts.

---

## 11. Testing

Perform:

- Unit testing
- Integration testing
- Manual testing

---

## 12. Production

Deploy only after testing is complete.

---

# Source of Truth

Engineering authority follows this order.

1. Product Philosophy
2. Specifications
3. Approved Reviews
4. Approved Drafts
5. Production Schema
6. Backend
7. Frontend

Higher levels override lower levels.

---

# Review Requirements

A review is complete only when:

- Review document exists.
- Decisions are recorded.
- Draft updated.
- Checklist updated.
- Review approved.

---

# Prohibited Practices

The following are not permitted.

- Updating production schema before review.
- Implementing undocumented business rules.
- Skipping draft review.
- Mixing temporary and permanent data models.
- Making schema changes without a review record.

---

# Success Criteria

A feature is considered complete only when:

- Philosophy approved.
- Specification approved.
- Draft approved.
- Review approved.
- Schema updated.
- Migration applied.
- Backend completed.
- Frontend completed.
- Tests passed.
- Documentation updated.

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2026-08-02 | Initial Engineering Review Process |