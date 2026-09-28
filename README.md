# TrialSetu — Real-Time Role-Based CTMS for AIIA
### Smart India Hackathon — PS26046

> **TrialSetu** ("Bridge for Clinical Trials") is a real-time, role-based Clinical Trial Management System (CTMS) designed for the **All India Institute of Ayurveda (AIIA)**, host to India's **National Pharmacovigilance Coordination Centre (NPvCC)** for the AYUSH systems of medicine.

TrialSetu replaces fragmented spreadsheets and paper logs with an auditable, relational system that unifies multi-centre trial governance, patient recruitment forecasting, informed consent traceability, and 24-hour expedited pharmacovigilance reporting under CDSCO New Drugs and Clinical Trials Rules 2019.

---

## 🏛️ Context & Problem Statement

AIIA manages a multi-centre clinical trial portfolio spanning herbal formulations (*Withania somnifera / Ashwagandha*, *Curcuma longa*, *Tinospora cordifolia / Guduchi*, *Swarna Bhasma*, and *AYUSH-64*). Prior to TrialSetu:
1. **Siloed Data:** Trial data lived across disparate spreadsheets, causing delayed protocol amendments and blind spots in recruitment pace.
2. **Safety Compliance Risks:** Missing statutory 24-hour reporting deadlines for Serious Adverse Events (SAEs) reported to the Central Drugs Standard Control Organization (CDSCO) and NPvCC.
3. **Audit Trail Vulnerabilities:** Spreadsheets lack 21 CFR Part 11 and ALCOA+ (Attributable, Legible, Contemporaneous, Original, Accurate, Complete, Consistent, Enduring, Available) compliance.

TrialSetu provides a **single source of truth** with:
- **8 Distinct Role-Specific Portals** (no hidden buttons — genuinely tailored workflows).
- **ALCOA+ Append-Only Audit Trail** enforced at the database and code level.
- **Voice-Based Adverse Event Ingestion** for participants & field ASHA workers (zero login friction).
- **Real-Time Server-Sent Events (SSE)** broadcasting safety signals and KPI updates across dashboards.
- **Predictive Completion Forecasting** dynamically calculating completion dates from actual participant velocity.
- **Ask-the-CTMS** natural-language conversational intelligence over live relational data.

---

## 🏗️ Architecture & Technology Stack

```
                          ┌──────────────────────────────────────────────┐
                          │   TrialSetu Frontend SPA (HTML5 / CSS / JS)  │
                          │   8 Role-Specific Portals & Design System    │
                          └──────┬───────────────▲───────────────────────┘
                                 │ HTTP / JSON   │ Server-Sent Events (SSE)
                                 ▼               │ (/api/stream)
┌────────────────────────────────────────────────┴────────────────────────┐
│                        Express 5.x API Server                           │
├─────────────────────────────────────────────────────────────────────────┤
│  • RBAC Least-Privilege Middleware (scrypt + HMAC-SHA256 Signed Tokens) │
│  • Predictive Completion Forecasting Engine (Velocity & Delay Risk)     │
│  • MedDRA & WHODrug Clinical NLP & Auto-Coding Engine                   │
│  • Ask-the-CTMS Natural Language SQL Query Engine                       │
├─────────────────────────────────────────────────────────────────────────┤
│                     Relational SQLite (node:sqlite)                     │
│  users | studies | milestones | participants | adverse_events |         │
│  audit_logs (APPEND-ONLY) | notes | documents                           │
└─────────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ HTTP Webhook
┌────────────────────────────────┴────────────────────────────────────────┐
│              n8n Companion Voice Workflow (IVR / WhatsApp)               │
│  Webhook -> Whisper STT -> Code Suggest -> 24h SAE Page -> Commit AE    │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Backend:** Node.js (v22 LTS) with Express.
- **Database:** Relational SQLite via Node's native built-in `node:sqlite` (DatabaseSync with WAL mode, foreign keys, and strict relational integrity).
- **Authentication & Security:** scrypt password hashing (64-byte salts), HMAC-SHA256 signed session tokens, and server-enforced role permissions on all write endpoints.
- **Real-Time Layer:** Server-Sent Events (`GET /api/stream`) broadcasting audit logs, adverse event alerts, and milestone updates.
- **Containerization:** Dockerfile (Node 22-slim with non-root security) and `docker-compose.yml`.
- **Automation Pipeline:** Companion n8n workflow (`n8n_voice_ae_reporting.json`).

---

## 🗄️ Database Schema & Relational Integrity

The schema implements relational constraints, foreign keys, and status enums:

| Table | Primary Key | Description & Mandatory Enums |
|---|---|---|
| `users` | `id` | `name`, `email`, `password_hash`, `password_salt`, `role` (`pi`, `coordinator`, `monitor`, `ethics`, `pv`, `admin`, `regulator`, `leadership`) |
| `studies` | `id` | `title`, `phase`, `stage` (MUST include all: `protocol_iec`, `ctri_registration`, **`site_activation`**, `screening`, `enrollment`, `randomization`, `ongoing`, `close_out`), `screened`, `enrolled`, `randomized`, `enrollment_target`, `status` (`ok`, `watch`, `risk`), `start_date`, `visit_compliance_done`, `visit_compliance_total`, `protocol_deviations`, `open_data_queries` |
| `milestones` | `id` | `study_id` (FK), `name`, `due_date`, `completed_date`, `status` (`pending`, `done`, `overdue`), `e_signed_by`, `e_signed_at` |
| `participants` | `id` | `study_id` (FK), `enrolled_date`, `status`, `consent_obtained`, `consent_date`, `consent_version` |
| `adverse_events`| `id` | `study_id` (FK), `participant_id` (FK), `description`, `severity` (`mild`, `moderate`, `serious`), `meddra_code`, `meddra_label`, `whodrug_code`, `reported_date`, `report_deadline`, `status` (`open`, `reported`, `closed`), `source` (`staff`, `voice_report`) |
| `audit_logs` | `id` | **APPEND-ONLY.** `user_name`, `action`, `entity_type`, `entity_id`, `alcoa_tags`, `created_at`. No `UPDATE` or `DELETE` statements allowed against this table. |
| `notes` | `id` | `study_id` (FK), `author`, `body`, `created_at` (Replaces paper notebooks) |
| `documents` | `id` | `study_id` (FK), `filename`, `category` (`protocol`, `consent_form`, `ae_photo`, `regulatory`, `other`), `uploaded_by`, `uploaded_at`, `file_data` |

---

## 👥 8 Distinct Role Portals

TrialSetu provides **8 separate landing portals**, tailored to the exact regulatory workflows of each clinical trial stakeholder:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   8 DISTINCT ROLE-BASED PORTALS                         │
├────────────────────┬───────────────────────────────────────────────────┤
│ 1. PI              │ My studies, milestones needing e-signature, pace   │
│ 2. Coordinator     │ Enrollment funnel, open queries, consent tracking │
│ 3. Monitor (CRA)   │ Assigned sites, visit compliance, deviations      │
│ 4. Ethics (IEC)    │ Protocol approval queue, consent version history  │
│ 5. PV (NPvCC)      │ SAE queue, MedDRA coding assist, DSMB signals     │
│ 6. Administration  │ User provisioning, RBAC matrix, system hardening   │
│ 7. Regulator       │ Strictly read-only compliance & ALCOA+ audit trail│
│ 8. Leadership      │ Executive rollup, risk map, stage distribution    │
└────────────────────┴───────────────────────────────────────────────────┘
```

1. **Principal Investigator (PI) Portal:**
   - Supervises assigned clinical protocols (*AIIA-ASHWA-01*, *AIIA-CURC-02*).
   - Dedicated table of milestones requiring 21 CFR Part 11 compliant digital signatures.
   - Predictive velocity charts displaying projected completion dates.
2. **Clinical Trial Coordinator Portal:**
   - Real-time screening-to-randomization recruitment funnel.
   - Informed consent tracking grid monitoring compliance under India's DPDP Act 2023.
   - Open laboratory and chemistry query resolution queue.
3. **Clinical Research Associate (Monitor / CRA) Portal:**
   - Site audit tracking across AIIA Apex Hospital New Delhi, Goa Satellite, etc.
   - Visit compliance gauge (Completed vs Scheduled visits).
   - Protocol deviation registry (Major vs Minor with CAPA links).
4. **Institutional Ethics Committee (IEC) Portal:**
   - Full board clearance dossier queue for initial approvals and protocol amendments.
   - Consent version traceability (Hindi v2.1, English v2.0, Marathi v1.2).
   - Expedited serious adverse event ethical review log.
5. **Pharmacovigilance (NPvCC Officer) Portal:**
   - Live intake queue with real-time MedDRA and WHODrug herbal coding.
   - **Active 24-hour statutory countdown clock** for serious adverse events.
   - DSMB organ class aggregate signals (Hepatobiliary, Dermatological, GI).
   - Herb-drug interaction surveillance (e.g., *Guduchi + Metformin* hepatic interaction).
6. **System Administration Portal:**
   - User account lifecycle management with role assignments.
   - Server cryptographic hardening and database WAL status.
7. **Regulator (CDSCO / AYUSH) Portal (Strictly Read-Only):**
   - **Genuinely read-only DOM and backend:** zero write/upload/signing controls exist in the interface.
   - Unfiltered ALCOA+ Audit Trail Explorer with real-time text filtering.
8. **Institutional Leadership (Director AIIA) Portal:**
   - High-level portfolio metrics (`GET /api/dashboard/leadership`).
   - Stage distribution pipeline across all 8 mandatory stages (including explicit `site_activation`).
   - Interactive Portfolio Risk Map.

---

## 🌟 Differentiating Features

### 1. Voice-Based AE Ingestion ("AyushSuraksha")
- Enables patients, family members, and rural ASHA/field health workers to report reactions by voice without creating an account or logging in.
- Browser-based **Web Speech API** integration with animated sound-wave visualizer and fallback manual transcript editing.
- Live debounced calls to `POST /api/code-suggest` auto-detecting symptoms:
  - *"Severe yellowing of eyes, dark urine, and vomiting after Guduchi"* -> Auto-maps to **MedDRA: 10019211 (Hepatic enzyme increased)**, **WHODrug: WHO-D-08831 (Tinospora cordifolia)**, severity: `serious`, deadline: `24 Hours`.
- If classified as `serious`, immediately triggers an **urgent PV On-Call Page** to Dr. Shalini Deshmukh and initiates the statutory 24-hour CDSCO countdown clock.

### 2. Ask-the-CTMS Natural Language Intelligence
A plain-language conversational search box querying live relational data. Answering at minimum:
- Which studies are at risk?
- What are open AE and SAE reporting deadlines?
- Show consent completion status across all trials.
- Which studies have open data queries?
- Which studies are in site activation stage?

### 3. Predictive Completion Forecasting Engine
Calculates true participant velocity instead of static RAG flags:
$$\text{Daily Velocity} = \frac{\text{Enrolled Participants}}{\max(\text{Elapsed Days}, 1)}$$
$$\text{Projected Days Needed} = \frac{\text{Enrollment Target} - \text{Enrolled Participants}}{\text{Daily Velocity}}$$
$$\text{Projected Completion Date} = \text{Current Date} + \text{Projected Days Needed}$$
Identifies recruitment bottlenecks months in advance.

### 4. Cross-Portfolio "Needs Attention" View
A single drawer consolidating:
- Active 24-hour statutory SAE deadlines.
- Overdue study milestones.
- Protocols with open data queries $\ge 10$.
- Studies with visit compliance $< 85\%$.

---

## 🔒 Compliance & Security Architecture

1. **ALCOA+ Audit Trail:** Attributable, Legible, Contemporaneous, Original, Accurate, Complete, Consistent, Enduring, Available. Enforced in code — any `UPDATE` or `DELETE` attempt against `audit_logs` raises an unhandled violation error.
2. **India DPDP Act 2023 & 2025 Rules:** Designed for Indian data sovereignty (NOT GDPR). Tracks explicit patient consent versions, assent dates, and role-based data minimization.
3. **Password Security:** Multi-round `scrypt` hashing with 64-byte random salts.
4. **Session Tokens:** HMAC-SHA256 tamper-evident tokens verified server-side on every write request.
5. **Regulatory Alignment:** Formatted to facilitate CDSCO Form 44 expedited safety reporting under Schedule Y and CT Rules 2019.

---

## 🗺️ Staged Roadmap

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | Auth, 8 Role Portals, Study Lifecycle, Forecasting, Notes, Documents, Ask-the-CTMS, ALCOA+ Audit, Voice AE Intake | **Complete & Runnable** |
| **Phase 2** | Live n8n voice pipeline with IVR/WhatsApp webhook, speech model fine-tuning for regional Ayurvedic terminology | Companion JSON Provided |
| **Phase 3** | **CDISC Integration** (CDASH -> SDTM [AE, DM, LB, CM] -> ADaM -> Define-XML) & **HL7 FHIR R4** APIs for ABDM / hospital electronic health record interoperability | Documented Future Scope |

---

## 🚀 Getting Started & Execution

### Prerequisites
- Node.js v22+ (tested on Node v22.14.0 LTS).
- Docker & Docker Compose (optional for containerized deployment).

### 1. Run Locally
```bash
# Navigate to project directory
cd trialsetu

# Install dependencies
npm install

# Run automated test suite (all 13 tests)
npm test

# Start TrialSetu CTMS server
npm start
```

Open your browser at: **`http://localhost:3000`**

### 2. Run via Docker
```bash
# Build and run container
docker build -t trialsetu:latest .
docker run -p 3000:3000 trialsetu:latest
```

### 3. Run with Docker Compose (TrialSetu + n8n Voice Pipeline)
```bash
docker-compose up --build
```
- TrialSetu CTMS: `http://localhost:3000`
- n8n Automation Engine: `http://localhost:5678`

---

## 🎭 Pre-Configured Demo Credentials (All 8 Roles)

*Default Password for all accounts:* **`Password123!`** *(Or use the 1-click Role Switcher Bar at the top of the app!)*

| Role | Name | Email | Focus Area |
|---|---|---|---|
| **PI** | Prof. (Dr.) Anand Sharma | `pi@aiia.gov.in` | Protocol Oversight & E-Signatures |
| **Coordinator** | Pooja Verma, MSc | `coordinator@aiia.gov.in` | Funnel & DPDP Consent Tracking |
| **Monitor** | Rajesh Nair, CRA | `monitor@aiia.gov.in` | Site Audits & Deviations |
| **Ethics** | Dr. Meenakshi Sundaram | `ethics@aiia.gov.in` | IEC Approvals & Consent Versions |
| **PV** | Dr. Shalini Deshmukh | `pv@aiia.gov.in` | NPvCC Safety Queue & 24h Clock |
| **Admin** | Vikram Sethi | `admin@aiia.gov.in` | User RBAC & System Configuration |
| **Regulator** | Dr. K. S. Murthy | `regulator@cdsco.gov.in` | Strictly Read-Only ALCOA+ Audit |
| **Leadership**| Prof. (Dr.) Tanuja Nesari| `leadership@aiia.gov.in` | Portfolio Rollup & Risk Map |

---

## 🎬 3-Minute Judge Walkthrough Script

1. **Introduction:** Open `http://localhost:3000`. Point out the header showing AIIA NPvCC branding, live SSE connection badge, and the Quick Role Switcher.
2. **PI Portal:** Note the pending milestone requiring e-signature (`MS-03`). Click **"E-Sign Milestone"**. Observe immediate cryptographic sign-off and ALCOA+ log generation.
3. **Voice AE Intake ("AyushSuraksha"):** Click the red **"Voice AE Intake"** button in the header (no login needed). Click **"Load Sample Clinical Transcript"** (or speak into mic). Notice live MedDRA (`10019211`) and WHODrug auto-coding. Click **"Submit"**.
4. **PV Portal & 24-hr Clock:** Switch to **Pharmacovigilance Portal**. Notice the urgent 24-hour statutory countdown banner for CDSCO Schedule Y compliance. Click **"Expedite CDSCO Form 44 Dossier"**.
5. **Ask-the-CTMS:** Click the brain icon in the header. Ask *"Which studies are at risk?"* or click one of the suggested query pills. Observe live tabular answers computed from SQLite.
6. **Regulator Portal:** Switch to **Regulator**. Highlight that all write buttons are absent (strictly read-only). Search the immutable ALCOA+ audit trail.
7. **Leadership Portal:** Switch to **Leadership**. Showcase the portfolio rollup, Stage Distribution Pipeline showing all 8 stages including `site_activation`, and the Institutional Risk Map.
