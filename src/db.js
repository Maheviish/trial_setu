// src/db.js - TrialSetu Relational Database Engine (SQLite via node:sqlite)
// Enforces strict relational constraints, foreign keys, and ALCOA+ append-only audit trail.

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'trialsetu.sqlite');

// Ensure parent dir exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Enable foreign keys and WAL mode for high concurrency
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// Initialize schema
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('pi', 'coordinator', 'monitor', 'ethics', 'pv', 'admin', 'regulator', 'leadership'))
    );

    CREATE TABLE IF NOT EXISTS studies (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      phase TEXT NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN ('protocol_iec', 'ctri_registration', 'site_activation', 'screening', 'enrollment', 'randomization', 'ongoing', 'close_out')),
      screened INTEGER DEFAULT 0,
      enrolled INTEGER DEFAULT 0,
      randomized INTEGER DEFAULT 0,
      enrollment_target INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ok', 'watch', 'risk')),
      start_date TEXT NOT NULL,
      visit_compliance_done INTEGER DEFAULT 0,
      visit_compliance_total INTEGER DEFAULT 0,
      protocol_deviations INTEGER DEFAULT 0,
      open_data_queries INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      due_date TEXT NOT NULL,
      completed_date TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'overdue')),
      e_signed_by TEXT,
      e_signed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
      enrolled_date TEXT NOT NULL,
      status TEXT NOT NULL,
      consent_obtained INTEGER DEFAULT 0,
      consent_date TEXT,
      consent_version TEXT
    );

    CREATE TABLE IF NOT EXISTS adverse_events (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('mild', 'moderate', 'serious')),
      meddra_code TEXT,
      meddra_label TEXT,
      whodrug_code TEXT,
      reported_date TEXT NOT NULL,
      report_deadline TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open', 'reported', 'closed')),
      source TEXT NOT NULL CHECK(source IN ('staff', 'voice_report'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      alcoa_tags TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('protocol', 'consent_form', 'ae_photo', 'regulatory', 'other')),
      uploaded_by TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      file_data TEXT
    );
  `);
}

// ALCOA+ Append-Only Audit Trail Enforcement
// Enforces in code that NO updates or deletes can touch audit_logs
function insertAuditLog({ user_name, action, entity_type, entity_id, alcoa_tags = 'Attributable, Contemporaneous, Accurate' }) {
  const id = `AUD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const created_at = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, user_name, action, entity_type, entity_id, alcoa_tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, user_name, action, entity_type, entity_id, alcoa_tags, created_at);
  
  const logEntry = {
    id,
    user_name,
    action,
    entity_type,
    entity_id,
    alcoa_tags,
    created_at
  };

  // Broadcast to SSE if sseEmitter registered
  if (global.trialsetuSseBroadcast) {
    global.trialsetuSseBroadcast('audit_log', logEntry);
  }

  return logEntry;
}

// Explicit protection against audit log mutation
function guardAuditMutation(sql) {
  const normalized = sql.trim().toUpperCase();
  if (normalized.startsWith('UPDATE AUDIT_LOGS') || normalized.startsWith('DELETE FROM AUDIT_LOGS') || normalized.startsWith('DROP TABLE AUDIT_LOGS')) {
    throw new Error('VIOLATION: audit_logs table is strictly append-only under 21 CFR Part 11 and ALCOA+ compliance.');
  }
}

// Hash password utility using scrypt
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
}

// Seed initial dataset for AIIA Hackathon PS26046 demo
function seedDatabase() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) return; // already seeded

  console.log('[TrialSetu] Seeding initial AIIA Clinical Trial database...');

  // 1. Seed Users (All 8 roles)
  const users = [
    { id: 'usr-pi', name: 'Prof. (Dr.) Anand Sharma', email: 'pi@aiia.gov.in', role: 'pi', pass: 'Password123!' },
    { id: 'usr-coord', name: 'Pooja Verma, MSc (Clin Res)', email: 'coordinator@aiia.gov.in', role: 'coordinator', pass: 'Password123!' },
    { id: 'usr-monitor', name: 'Rajesh Nair, CRA', email: 'monitor@aiia.gov.in', role: 'monitor', pass: 'Password123!' },
    { id: 'usr-ethics', name: 'Dr. Meenakshi Sundaram', email: 'ethics@aiia.gov.in', role: 'ethics', pass: 'Password123!' },
    { id: 'usr-pv', name: 'Dr. Shalini Deshmukh, MD (Ayur)', email: 'pv@aiia.gov.in', role: 'pv', pass: 'Password123!' },
    { id: 'usr-admin', name: 'Vikram Sethi', email: 'admin@aiia.gov.in', role: 'admin', pass: 'Password123!' },
    { id: 'usr-regulator', name: 'Dr. K. S. Murthy (CDSCO / AYUSH)', email: 'regulator@cdsco.gov.in', role: 'regulator', pass: 'Password123!' },
    { id: 'usr-leadership', name: 'Prof. (Dr.) Tanuja Nesari, Director AIIA', email: 'leadership@aiia.gov.in', role: 'leadership', pass: 'Password123!' }
  ];

  const userStmt = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, password_salt, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const u of users) {
    const { hash, salt } = hashPassword(u.pass);
    userStmt.run(u.id, u.name, u.email, hash, salt, u.role);
  }

  // 2. Seed Studies (AIIA Ayurveda clinical trial portfolio)
  const studies = [
    {
      id: 'AIIA-ASHWA-01',
      title: 'Double-Blind Randomized Placebo-Controlled Trial of Standardized Withania somnifera (Ashwagandha) Root Extract in Generalized Anxiety Disorder',
      phase: 'Phase II',
      stage: 'ongoing',
      screened: 180,
      enrolled: 124,
      randomized: 120,
      enrollment_target: 150,
      status: 'ok',
      start_date: '2025-06-15',
      visit_compliance_done: 480,
      visit_compliance_total: 510,
      protocol_deviations: 2,
      open_data_queries: 4
    },
    {
      id: 'AIIA-CURC-02',
      title: 'Multicentre Comparative Clinical Trial of Curcuma longa (Curcumin) + Boswellia serrata vs. Celecoxib in Knee Osteoarthritis (Janu Sandhigatavata)',
      phase: 'Phase III',
      stage: 'enrollment',
      screened: 290,
      enrolled: 142,
      randomized: 138,
      enrollment_target: 240,
      status: 'watch',
      start_date: '2025-09-01',
      visit_compliance_done: 310,
      visit_compliance_total: 360,
      protocol_deviations: 6,
      open_data_queries: 11
    },
    {
      id: 'AIIA-GUDU-03',
      title: 'Safety and Glycemic Efficacy Evaluation of Tinospora cordifolia (Guduchi Ghanavati) as Add-on to Metformin in Newly Diagnosed Type 2 Diabetes Mellitus',
      phase: 'Phase II',
      stage: 'screening',
      screened: 88,
      enrolled: 38,
      randomized: 35,
      enrollment_target: 180,
      status: 'risk',
      start_date: '2025-04-10',
      visit_compliance_done: 102,
      visit_compliance_total: 135,
      protocol_deviations: 9,
      open_data_queries: 24
    },
    {
      id: 'AIIA-AYUSH64-04',
      title: 'Long-term Multicentric Observational Registry of AYUSH-64 in Post-Viral Fatigue and Chronic Respiratory Sequelae',
      phase: 'Phase IV',
      stage: 'site_activation',
      screened: 0,
      enrolled: 0,
      randomized: 0,
      enrollment_target: 500,
      status: 'ok',
      start_date: '2026-02-01',
      visit_compliance_done: 0,
      visit_compliance_total: 0,
      protocol_deviations: 0,
      open_data_queries: 1
    },
    {
      id: 'AIIA-SWARNA-05',
      title: 'Standardized Bio-distribution and Safety Biomarker Profiling of Swarna Bhasma in Healthy Volunteers and Rheumatoid Cohorts',
      phase: 'Phase I',
      stage: 'protocol_iec',
      screened: 0,
      enrolled: 0,
      randomized: 0,
      enrollment_target: 40,
      status: 'watch',
      start_date: '2026-01-15',
      visit_compliance_done: 0,
      visit_compliance_total: 0,
      protocol_deviations: 0,
      open_data_queries: 0
    }
  ];

  const studyStmt = db.prepare(`
    INSERT INTO studies (id, title, phase, stage, screened, enrolled, randomized, enrollment_target, status, start_date, visit_compliance_done, visit_compliance_total, protocol_deviations, open_data_queries)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of studies) {
    studyStmt.run(
      s.id, s.title, s.phase, s.stage, s.screened, s.enrolled, s.randomized,
      s.enrollment_target, s.status, s.start_date, s.visit_compliance_done,
      s.visit_compliance_total, s.protocol_deviations, s.open_data_queries
    );
  }

  // 3. Seed Milestones
  const milestones = [
    { id: 'MS-01', study_id: 'AIIA-ASHWA-01', name: 'Institutional Ethics Committee (IEC) Clearance', due_date: '2025-05-15', completed_date: '2025-05-10', status: 'done', e_signed_by: 'Dr. Meenakshi Sundaram', e_signed_at: '2025-05-10T14:30:00Z' },
    { id: 'MS-02', study_id: 'AIIA-ASHWA-01', name: 'CTRI Registration (CTRI/2025/06/07812)', due_date: '2025-06-01', completed_date: '2025-05-28', status: 'done', e_signed_by: 'Prof. (Dr.) Anand Sharma', e_signed_at: '2025-05-28T10:15:00Z' },
    { id: 'MS-03', study_id: 'AIIA-ASHWA-01', name: 'Interim Safety DSMB Review 50% Enrollment', due_date: '2026-03-30', completed_date: null, status: 'pending', e_signed_by: null, e_signed_at: null },
    { id: 'MS-04', study_id: 'AIIA-CURC-02', name: 'IEC Approval & Multicenter Regulatory Notification', due_date: '2025-08-15', completed_date: '2025-08-20', status: 'done', e_signed_by: 'Dr. Meenakshi Sundaram', e_signed_at: '2025-08-20T16:00:00Z' },
    { id: 'MS-05', study_id: 'AIIA-CURC-02', name: 'Site Activation AIIA Delhi & Goa Satellite Center', due_date: '2025-09-01', completed_date: '2025-09-01', status: 'done', e_signed_by: 'Prof. (Dr.) Anand Sharma', e_signed_at: '2025-09-01T11:00:00Z' },
    { id: 'MS-06', study_id: 'AIIA-CURC-02', name: 'Mid-term Enrollment Audit (120 Subjects)', due_date: '2026-02-15', completed_date: null, status: 'overdue', e_signed_by: null, e_signed_at: null },
    { id: 'MS-07', study_id: 'AIIA-GUDU-03', name: 'Central Ethics Review and Blood Specimen Protocol', due_date: '2025-04-01', completed_date: '2025-04-05', status: 'done', e_signed_by: 'Dr. Meenakshi Sundaram', e_signed_at: '2025-04-05T09:45:00Z' },
    { id: 'MS-08', study_id: 'AIIA-GUDU-03', name: 'Corrective Action Plan for Slow Enrollment Rate', due_date: '2026-02-28', completed_date: null, status: 'overdue', e_signed_by: null, e_signed_at: null },
    { id: 'MS-09', study_id: 'AIIA-AYUSH64-04', name: 'Investigational Site Activation Checklist & Pharmacy Sign-off', due_date: '2026-04-10', completed_date: null, status: 'pending', e_signed_by: null, e_signed_at: null },
    { id: 'MS-10', study_id: 'AIIA-SWARNA-05', name: 'IEC Full Board Dossier Submission', due_date: '2026-04-20', completed_date: null, status: 'pending', e_signed_by: null, e_signed_at: null }
  ];

  const msStmt = db.prepare(`
    INSERT INTO milestones (id, study_id, name, due_date, completed_date, status, e_signed_by, e_signed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of milestones) {
    msStmt.run(m.id, m.study_id, m.name, m.due_date, m.completed_date, m.status, m.e_signed_by, m.e_signed_at);
  }

  // 4. Seed Participants
  const participants = [
    { id: 'PT-ASH-001', study_id: 'AIIA-ASHWA-01', enrolled_date: '2025-06-20', status: 'Active', consent_obtained: 1, consent_date: '2025-06-19', consent_version: 'v2.1' },
    { id: 'PT-ASH-002', study_id: 'AIIA-ASHWA-01', enrolled_date: '2025-06-22', status: 'Active', consent_obtained: 1, consent_date: '2025-06-21', consent_version: 'v2.1' },
    { id: 'PT-ASH-003', study_id: 'AIIA-ASHWA-01', enrolled_date: '2025-07-01', status: 'Active', consent_obtained: 1, consent_date: '2025-06-30', consent_version: 'v2.1' },
    { id: 'PT-CURC-101', study_id: 'AIIA-CURC-02', enrolled_date: '2025-09-10', status: 'Active', consent_obtained: 1, consent_date: '2025-09-09', consent_version: 'v2.0' },
    { id: 'PT-CURC-102', study_id: 'AIIA-CURC-02', enrolled_date: '2025-09-12', status: 'Withdrawn', consent_obtained: 1, consent_date: '2025-09-11', consent_version: 'v2.0' },
    { id: 'PT-GUDU-201', study_id: 'AIIA-GUDU-03', enrolled_date: '2025-04-20', status: 'Active', consent_obtained: 1, consent_date: '2025-04-19', consent_version: 'v1.2' },
    { id: 'PT-GUDU-202', study_id: 'AIIA-GUDU-03', enrolled_date: '2025-05-02', status: 'Active', consent_obtained: 0, consent_date: null, consent_version: 'Pending' }
  ];

  const partStmt = db.prepare(`
    INSERT INTO participants (id, study_id, enrolled_date, status, consent_obtained, consent_date, consent_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of participants) {
    partStmt.run(p.id, p.study_id, p.enrolled_date, p.status, p.consent_obtained, p.consent_date, p.consent_version);
  }

  // 5. Seed Adverse Events (including high-priority serious event for CDSCO/NPvCC 24-hr deadline demo)
  const adverseEvents = [
    {
      id: 'AE-2026-001',
      study_id: 'AIIA-CURC-02',
      participant_id: 'PT-CURC-101',
      description: 'Transient mild gastric burning and dyspepsia following morning decoction dose on empty stomach',
      severity: 'mild',
      meddra_code: '10013946',
      meddra_label: 'Dyspepsia',
      whodrug_code: 'WHO-D-04512',
      reported_date: '2026-03-20',
      report_deadline: '2026-04-03',
      status: 'reported',
      source: 'staff'
    },
    {
      id: 'AE-2026-002',
      study_id: 'AIIA-ASHWA-01',
      participant_id: 'PT-ASH-002',
      description: 'Bilateral erythematous pruritic papular rash over upper extremities after 4 weeks of therapy',
      severity: 'moderate',
      meddra_code: '10037844',
      meddra_label: 'Rash pruritic',
      whodrug_code: 'WHO-D-01928',
      reported_date: '2026-03-24',
      report_deadline: '2026-04-07',
      status: 'open',
      source: 'staff'
    },
    {
      id: 'AE-2026-003',
      study_id: 'AIIA-GUDU-03',
      participant_id: 'PT-GUDU-201',
      description: 'Acute jaundice with scleral icterus and elevated serum ALT/AST (>5x ULN). Suspected idiosyncratic drug-herb induced liver injury (DILI). Hospitalized at AIIA Inpatient Ward.',
      severity: 'serious',
      meddra_code: '10019211',
      meddra_label: 'Hepatic enzyme increased',
      whodrug_code: 'WHO-D-08831',
      reported_date: '2026-03-27',
      report_deadline: '2026-03-28T18:00:00Z', // 24-hour CDSCO / NPvCC statutory deadline!
      status: 'open',
      source: 'voice_report'
    }
  ];

  const aeStmt = db.prepare(`
    INSERT INTO adverse_events (id, study_id, participant_id, description, severity, meddra_code, meddra_label, whodrug_code, reported_date, report_deadline, status, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const ae of adverseEvents) {
    aeStmt.run(
      ae.id, ae.study_id, ae.participant_id, ae.description, ae.severity,
      ae.meddra_code, ae.meddra_label, ae.whodrug_code, ae.reported_date,
      ae.report_deadline, ae.status, ae.source
    );
  }

  // 6. Seed Notes
  const notes = [
    { id: 'NOTE-01', study_id: 'AIIA-ASHWA-01', author: 'Prof. (Dr.) Anand Sharma', body: 'Subject PT-ASH-001 showed marked HAM-A score reduction (-9 pts) at Week 8. Pill count verification indicates 98% compliance.', created_at: '2026-03-15T11:20:00Z' },
    { id: 'NOTE-02', study_id: 'AIIA-CURC-02', author: 'Pooja Verma, MSc', body: 'Site visit confirmed supply of enteric-coated Boswellia extracts batch BSW-2025-09 received in good condition with cold chain log intact.', created_at: '2026-03-18T14:45:00Z' },
    { id: 'NOTE-03', study_id: 'AIIA-GUDU-03', author: 'Rajesh Nair, CRA', body: 'Discrepancy noted in HbA1c lab upload for 4 subjects at New Delhi site. Open data query raised (#Q-304). Requires coordinator rectification.', created_at: '2026-03-22T09:10:00Z' }
  ];

  const noteStmt = db.prepare(`
    INSERT INTO notes (id, study_id, author, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const n of notes) {
    noteStmt.run(n.id, n.study_id, n.author, n.body, n.created_at);
  }

  // 7. Seed Documents
  const documents = [
    { id: 'DOC-01', study_id: 'AIIA-ASHWA-01', filename: 'AIIA_Ashwa_Protocol_Final_v2.4.pdf', category: 'protocol', uploaded_by: 'Prof. (Dr.) Anand Sharma', uploaded_at: '2025-05-02T10:00:00Z', file_data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXr...' },
    { id: 'DOC-02', study_id: 'AIIA-ASHWA-01', filename: 'Patient_Informed_Consent_Hindi_v2.1.pdf', category: 'consent_form', uploaded_by: 'Pooja Verma, MSc', uploaded_at: '2025-05-12T14:15:00Z', file_data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXr...' },
    { id: 'DOC-03', study_id: 'AIIA-CURC-02', filename: 'CTRI_Trial_Registration_Certificate.pdf', category: 'regulatory', uploaded_by: 'Prof. (Dr.) Anand Sharma', uploaded_at: '2025-08-25T16:30:00Z', file_data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXr...' },
    { id: 'DOC-04', study_id: 'AIIA-GUDU-03', filename: 'AE_Liver_Function_Test_Panel_PT201.pdf', category: 'ae_photo', uploaded_by: 'Dr. Shalini Deshmukh', uploaded_at: '2026-03-27T10:00:00Z', file_data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXr...' }
  ];

  const docStmt = db.prepare(`
    INSERT INTO documents (id, study_id, filename, category, uploaded_by, uploaded_at, file_data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const d of documents) {
    docStmt.run(d.id, d.study_id, d.filename, d.category, d.uploaded_by, d.uploaded_at, d.file_data);
  }

  // 8. Seed Audit Logs with ALCOA+ Tags
  const auditLogs = [
    { user_name: 'System Provisioning', action: 'INITIALIZE_CTMS_DATABASE', entity_type: 'SYSTEM', entity_id: 'AIIA-CTMS-ROOT', alcoa_tags: 'Attributable, Original, Complete' },
    { user_name: 'Dr. Meenakshi Sundaram', action: 'APPROVE_IEC_PROTOCOL', entity_type: 'STUDY', entity_id: 'AIIA-ASHWA-01', alcoa_tags: 'Attributable, Contemporaneous, Enduring' },
    { user_name: 'Prof. (Dr.) Anand Sharma', action: 'SIGN_MILESTONE_MS02', entity_type: 'MILESTONE', entity_id: 'MS-02', alcoa_tags: 'Attributable, Legible, Accurate' },
    { user_name: 'Pooja Verma, MSc', action: 'RECORD_CONSENT_PT001', entity_type: 'PARTICIPANT', entity_id: 'PT-ASH-001', alcoa_tags: 'Attributable, Contemporaneous, Complete' },
    { user_name: 'Field Worker (Voice Intake)', action: 'INGEST_VOICE_SAE_REPORT', entity_type: 'ADVERSE_EVENT', entity_id: 'AE-2026-003', alcoa_tags: 'Original, Contemporaneous, Accurate, Complete' },
    { user_name: 'Dr. Shalini Deshmukh', action: 'TRIGGER_NPVCC_24H_PAGE', entity_type: 'ADVERSE_EVENT', entity_id: 'AE-2026-003', alcoa_tags: 'Attributable, Contemporaneous, Enduring' }
  ];

  for (const log of auditLogs) {
    insertAuditLog(log);
  }

  console.log('[TrialSetu] Seed complete! 8 users, 5 studies, milestones, participants, AEs, and ALCOA+ logs ready.');
}

// Call schema initialization & seed immediately
initSchema();
seedDatabase();

module.exports = {
  db,
  insertAuditLog,
  guardAuditMutation,
  hashPassword,
  verifyPassword
};
