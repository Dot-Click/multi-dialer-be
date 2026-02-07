# CallScout Multi-Line Dialer Application — Backend

## Project Overview
CallScout is a professional web-based SaaS Multi-Line Dialer & CRM platform designed to enhance outbound calling efficiency for sales teams, real estate professionals, and telemarketing agencies. 

The backend is built with **Node.js** and **Express.js**, utilizing **Prisma ORM** with **PostgreSQL** for robust data management. It supports simultaneous multi-line dialing, AI-driven compliance, automated lead management, and multi-channel communication (Voice, SMS, Email, Video, and Direct Mail).

---

## Technical Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **ORM**: Prisma
- **Database**: PostgreSQL (AWS/GCP ready)
- **Authentication**: BetterAuth (JWT/OAuth2)
- **API Documentation**: Swagger (OpenAPI 3.0)
- **File Storage**: Cloudinary
- **Email Service**: SendGrid
- **Telephony**: Twilio

---

## Core Modules

### 1. User & Company Management
- **Role-Based Access Control (RBAC)**: Supports `ADMIN`, `AGENT`, and `OWNER` roles.
- **Secure Authentication**: Integrated with BetterAuth for session management and OAuth providers.
- **Company Branding**: Customizable appearance settings, including dashboard section visibility and time zones.

### 2. Multi-Line Dialer (Powered by Twilio)
- **Simultaneous Dialing**: Supports 2–10 active lines per agent.
- **Dialing Modes**: Preview, Power, and Predictive (Work-in-progress).
- **Number Management**: Purchase and manage US-based phone numbers directly within the platform.
- **Webhook Integration**: Real-time handling of voice calls, call status updates, and recording statuses.

### 3. Lead & Contact Management
- **Centralized CRM**: Manage individual leads and organized contact lists.
- **Automation**: Lead sheets with customizable questionnaires for qualifying leads.
- **Action Plans**: Schedule automated follow-ups via email, phone calls, or tasks.

### 4. Library & Content Management
- **Call Scripts**: Create and manage scripts for agents.
- **Media Center**: Hosting for voicemail drops, "on-hold" music, and video messages.
- **Templates**: Centralized repository for SMS and Email templates.

### 5. Compliance & Reporting
- **DNC Scrubbing**: Federal Do Not Call compliance scrubbing.
- **Reputation Monitoring**: Monitoring outbound number health to avoid spam flags.
- **AI Analytics**: Call transcription and sentiment analysis (integrated with Gemini/OpenAI).

---

## API Integrations

| Provider | Purpose |
| :--- | :--- |
| **Twilio** | Telephony, multi-line dialing, SMS/MMS |
| **SendGrid** | Transactional and marketing emails |
| **Cloudinary** | Media asset management |

## Folder Structure
```text
multi-dialer-be/
├── prisma/                # Database schema and migrations
│   └── schema.prisma      # Main database definition
├── src/
│   ├── index.ts           # Entry point and server initialization
│   ├── lib/               # Core configurations (Auth, Cloudinary, Prisma)
│   ├── middlewares/       # Auth & Role-based access middlewares
│   ├── routes/            # API Route definitions & Modules
│   │   ├── calling/       # Core Dialer logic (Twilio integration)
│   │   ├── library/       # Content management (Scripts, SMS, Email)
│   │   ├── systemSettings/# Admin/Owner configurations
│   │   └── ...            # CRM & User modules
│   ├── utils/             # Helper utilities (Swagger, Email, Response Handlers)
│   └── zod/              # Zod schemas for input validation
└── scripts/               # Build and maintenance scripts
```

---

## Database Design

The system uses a highly relational structure centered around the `User` and their `System_Setting`. Below is a high-level representation of the core entities:

```mermaid
erDiagram
    USER ||--o{ SESSION : has
    USER ||--o{ SYSTEM_SETTING : configures
    USER ||--o{ COMPANY : belongs_to
    USER ||--o{ CONTACT : owns
    
    SYSTEM_SETTING ||--o{ CALLER_ID : defines
    SYSTEM_SETTING ||--|{ DIALER_SETTING : includes
    SYSTEM_SETTING ||--o{ INTEGRATION : manages
    SYSTEM_SETTING ||--o{ LEAD_SHEET : contains
    
    LIBRARY ||--o{ SCRIPT : contains
    LIBRARY ||--o{ SMS_TEMPLATE : contains
    LIBRARY ||--o{ EMAIL_TEMPLATE : contains
    LIBRARY ||--o{ MEDIA_CENTER : contains
    
    USER ||--o{ LIBRARY : manages
```

---

## API Routes Overview

The application exposes a RESTful API with structured routes:

### Authentication
- `POST /api/auth/*` - All authentication endpoints (Sign in, Sign up, Session)

### Core Dialer (`/api/calling`)
- `POST /test-call` - Trigger a test call
- `POST /leads` - Add leads to the dialer queue
- `GET /status` - Real-time dialer status
- `POST /webhooks/voice` - Twilio Voice Webhook
- `POST /webhooks/call-status` - Twilio Status Webhook

### Library & Content (`/api/library`)
- `/script`, `/sms`, `/email` - CRUD for communication templates
- `/media-center` - Upload and manage audio/video assets
- `/callback-prompt` - Configure IVR/Voicemail prompts

### System Settings (`/api/system-settings`)
- `/caller-id` - Management of outbound caller IDs
- `/dialer-settings` - Global dialer behavior (Time Shield, etc.)
- `/integrations` - Third-party API credential management
- `/lead-sheet` - Customizable qualification questionnaires

### CRM (`/api/contact`, `/api/contact-list`)
- `/contact` - Manage individual leads/contacts
- `/contact-list` - Grouping contacts into dialer-ready lists

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL Database
- Twilio Account (for dialing features)
- SendGrid/Cloudinary API keys

### Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd multi-dialer-be
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   Create a `.env` file in the root directory and add the following:
   ```env
   PORT=5000
   DATABASE_URL="postgresql://user:password@localhost:5432/callscout"
   BETTER_AUTH_SECRET="your_secret"
   BETTER_AUTH_URL="http://localhost:5000"
   SESSION_SECRET="your_session_secret"
   
   # Integrations
   TWILIO_ACCOUNT_SID="your_sid"
   TWILIO_AUTH_TOKEN="your_token"
   TWILIO_FROM_NUMBER="your_twilio_number"
   
   CLOUDINARY_CLOUD_NAME="your_cloud_name"
   CLOUDINARY_API_KEY="your_api_key"
   CLOUDINARY_API_SECRET="your_secret"
   
   SENDGRID_API_KEY="your_key"
   EMAIL_USER="your_email"
   
   FRONTEND_URL="http://localhost:3000"
   ```
4. Initialize the database:
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

### Running the Application
- **Development Mode**:
  ```bash
  npm run dev
  ```
- **Production Build**:
  ```bash
  npm run build
  npm start
  ```
- **Prisma Studio** (Database GUI):
  ```bash
  npm run studio
  ```

---

## API Documentation
Once the server is running, you can access the interactive Swagger documentation at:
`http://localhost:5000/api-docs`

---

## License
This project is licensed under the ISC License.
