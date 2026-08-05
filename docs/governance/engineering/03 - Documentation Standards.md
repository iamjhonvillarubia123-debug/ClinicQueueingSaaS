# Documentation Standards

---

# Purpose

This document defines the documentation standards for the Clinic Queueing SaaS project.

The objective is to ensure that all documentation is consistent, maintainable, searchable, and useful throughout the project's lifecycle.

Documentation is considered a first-class engineering artifact and must be maintained alongside the codebase.

---

# Documentation Principles

All project documentation shall follow these principles.

- Documentation Before Implementation
- One Source of Truth
- Clear Ownership
- Version Controlled
- Reviewable
- Maintainable
- Consistent Structure

---

# Documentation Hierarchy

The order of authority is:

1. Product Philosophy
2. Specifications
3. Reviews
4. Architecture Decision Records (ADRs)
5. Draft Models
6. Production Code
7. User Documentation

Higher-level documents take precedence over lower-level documents.

---

# Documentation Categories

## Product Philosophy

Purpose:

Defines why the product behaves the way it does.

Examples:

- Queue Philosophy
- Patient Experience Principles
- Clinic Workflow Philosophy

---

## Specifications

Purpose:

Describe business requirements.

Examples:

- Patient Workflow
- Booking Workflow
- Queue Workflow
- Notification Workflow

---

## Drafts

Purpose:

Proposed implementation before approval.

Examples:

- Prisma drafts
- API drafts
- UI drafts

Drafts are working documents and may change frequently.

---

## Reviews

Purpose:

Record approved engineering decisions.

Every review shall include:

- Review Information
- Purpose
- Scope
- Decision Log
- Impact Assessment
- Pending Questions
- Implementation Checklist
- Version History

---

## Architecture Decision Records (ADR)

Purpose:

Record major architectural decisions.

Examples:

- Why BookingDraft exists
- Queue Number strategy
- SMS notification strategy

ADRs explain **why**, not **how**.

---

# Markdown Standards

Use:

- One H1 title
- Logical heading hierarchy
- Tables for structured information
- Bullet lists for short collections
- Numbered lists for sequential steps
- Code blocks for code and schemas

Avoid:

- Deep heading nesting
- Long unstructured paragraphs
- Mixing code and explanatory text without headings

---

# Naming Standards

Use descriptive names.

Examples:

```
Review-0001-Appointment.md
ADR-0001-Queue-Number-Strategy.md
Booking & Queue Workflow Specification.md
```

Avoid vague names such as:

```
review.md
notes.md
draft2.md
final-final.md
```

Humanity has produced enough `final-final-v2-really-final.md` files already.

---

# Folder Organization

Example:

```text
docs/
│
├── philosophy/
├── specifications/
├── governance/
├── reviews/
├── decisions/
└── archive/
```

Each folder should contain documents with a single responsibility.

---

# Versioning

Significant documents should include:

- Version
- Date
- Summary of changes

Minor editorial corrections do not require a version increment.

---

# Review Requirement

Documentation affecting business rules must be reviewed before implementation.

Documentation is not complete until it accurately reflects the approved implementation.

---

# Prohibited Practices

Do not:

- Duplicate business rules across multiple documents.
- Keep outdated documentation.
- Store implementation details inside Product Philosophy.
- Modify approved documents without updating version history.
- Leave placeholder sections indefinitely.

---

# Success Criteria

Documentation is considered complete when:

- Accurate
- Current
- Reviewed
- Versioned
- Referenced by related documents
- Consistent with the Product Philosophy

---

# Related Documents

- 01 - Engineering Review Process.md
- 02 - Database Governance.md
- 04 - Decision Record Standard.md
- 05 - Review Template.md

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2026-08-02 | Initial Documentation Standards |