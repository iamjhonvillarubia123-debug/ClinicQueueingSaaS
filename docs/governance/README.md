# Engineering Governance

---

## Purpose

This folder contains the engineering governance documents for the Clinic Queueing SaaS project.

These documents define how software is designed, reviewed, documented, implemented, and maintained throughout the project.

The objective is to ensure that all technical decisions follow a consistent, review-driven engineering process.

These governance documents are the single source of truth for engineering standards.

---

# Governance Documents

The documents in this folder should be read in the following order.

## 01 - Engineering Review Process

Defines the complete engineering workflow from idea to implementation.

Topics include:

- Review lifecycle
- Approval workflow
- Draft process
- Implementation order
- Review completion

---

## 02 - Database Governance

Defines how database changes are designed and approved.

Topics include:

- Prisma workflow
- Schema updates
- Draft models
- Migration policy
- Database review process

---

## 03 - Documentation Standards

Defines documentation requirements across the project.

Topics include:

- Markdown standards
- Naming conventions
- Folder organization
- Review documents
- Specifications
- Product documentation

---

## 04 - Decision Record Standard

Defines how engineering decisions are recorded.

Topics include:

- Architecture Decision Records (ADR)
- Technical Reviews
- Decision logs
- Version history

---

## 05 - Review Template

Provides the standard template used for all engineering reviews.

Every review in this project should follow this template.

---

# Engineering Workflow

Every major feature follows the same lifecycle.

```text
Idea

↓

Product Philosophy

↓

Specification

↓

Draft

↓

Technical Review

↓

Draft Updated

↓

Review Approved

↓

Production Schema

↓

Migration

↓

Backend

↓

Frontend

↓

Testing

↓

Production
```

Implementation must never skip an earlier stage.

---

# Design Principles

This project follows these engineering principles.

- One Source of Truth
- Review Before Implementation
- Small Vertical Slices
- Clean Architecture
- Business Rules Before Code
- Stable Production Schema
- Documentation First
- Database Before API
- API Before Frontend

---

# Source of Truth

The order of authority is:

1. Product Philosophy
2. Approved Specifications
3. Approved Review Documents
4. Approved Draft Models
5. Production Prisma Schema
6. Backend Implementation
7. Frontend Implementation

If two documents conflict, the document with higher authority takes precedence.

---

# Governance Rule

No production implementation may begin until:

- Product Philosophy is approved.
- Specification is approved.
- Draft is reviewed.
- Review is approved.

Production code must always follow approved documentation.

---

# Version

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2026-08-02 | Initial Engineering Governance |