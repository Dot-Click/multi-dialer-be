# Backend Architecture & Feature Analysis

## Technology Stack
- **Runtime:** Node.js (v20+) with TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL via Prisma ORM
- **Authentication:** Better Auth (session-based)
- **External APIs:** Twilio (Voice/SMS), SendGrid (Emails), Open AI / Groq (AI functionality), Web Push (Notifications)
- **Background Jobs:** Node-cron

---

## Core Domain Models & Features

### 1. User & Access Management
- **Roles:** `OWNER` / `SUPER_ADMIN`, `ADMIN`, `AGENT`
- **Status:** Active, Pending, Suspended, Deactivated
- **Features:** Session management, email verification, banning, tenant-like isolation (Owners have Admins/Agents).

### 2. Telephony & Calling (`/calling`)
- **Integration:** Powered by Twilio SDK.
- **Dialer Types:** Power, Predictive, Preview.
- **Features:**
  - Call Records & Logs.
  - Caller ID management (Rotate numbers, default caller ID).
  - Dialer Settings (Time Shields/TCPA restrictions, answering machine detection).
  - Call routing & hold logic.

### 3. Contact & Lead Management (`/contact`, `/contact-list`)
- **Entities:** Contacts, Contact Folders, Contact Groups, Contact Lists.
- **Features:**
  - Create, read, update, delete contacts.
  - Multi-email and multi-phone number support per contact.
  - Custom lead sheet fields (custom qualification questions).
  - Webhook ingestion (e.g., MyPlusLeads).

### 4. Library & Assets (`/library/*`)
- **Scripts:** Pre-written call scripts for agents.
- **Templates:** SMS and Email templates.
- **Media Center:** Audio/Video files for voicemails, on-hold music, IVR, and callback prompts.
- **Signatures:** Email signatures for users.

### 5. System Settings (`/system-settings/*`)
- **Regulatory:** TCPA (calling hour limits) and GDPR (data retention limits).
- **Dispositions:** Custom call outcomes (e.g., "Not Interested", "Left Voicemail").
- **Action Plans:** Automated workflows (Frequency-based or Date-based triggers).
- **Lead Sheets:** Customizable questionnaires for agents to fill out during a call.
- **Integrations:** Third-party connections (MyPlusLeads active, Webhook system in place).

### 6. Notifications & Scheduling (`/calendar`, `/notification`)
- **Calendar:** Event tracking (Tasks, Appointments, Follow-ups).
- **Notifications:** In-app alerts, push notifications (`web-push`), and email logs.

### 7. Super Admin & Billing (`/super-admin-reports`, `/subscriptions`)
- **Billing:** Invoice tracking, plans (Starter, Pro, Enterprise), Billing Cycles.
- **Audit Logs:** Tracking administrative actions across the platform.

---

## API Structure & Flow
The backend uses a standard monolithic REST API pattern.
- **Router (`routes.ts`)**: Acts as the central hub connecting all domains.
- **Middleware (`auth.middleware.ts`)**: `protectRoute` enforces authentication, and `checkRole` ensures users can only access their permitted endpoints.
- **Controllers/Services**: Most domains are split into a Controller (handling HTTP req/res) and Service (handling Prisma DB logic).
