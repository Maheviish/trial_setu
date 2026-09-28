// src/server.js - TrialSetu Express API Server
// Connects SQLite, Auth, RBAC, Predictive Forecasting, MedDRA/WHODrug NLP, and SSE Stream.

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { db, insertAuditLog, verifyPassword, hashPassword } = require('./db');
const { createToken, authenticate, optionalAuthenticate, requireRoles } = require('./auth');
const { computeForecast } = require('./forecast');
const { suggestCodes, askCtms } = require('./nlp');
const { registerClient, broadcast } = require('./sse');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' })); // Support base64 document/photo uploads
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve frontend static assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// -------------------------------------------------------------
// 1. Authentication Endpoints
// -------------------------------------------------------------

// POST /api/login -> { token, user }
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials. User not found.' });
  }

  const isValid = verifyPassword(password, user.password_hash, user.password_salt);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials. Password mismatch.' });
  }

  const tokenPayload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  const token = createToken(tokenPayload);

  insertAuditLog({
    user_name: user.name,
    action: 'USER_LOGIN_SUCCESS',
    entity_type: 'USER',
    entity_id: user.id,
    alcoa_tags: 'Attributable, Contemporaneous, Consistent'
  });

  return res.json({
    token,
    user: tokenPayload
  });
});

// GET /api/me -> Verify session token
app.get('/api/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// -------------------------------------------------------------
// 2. Studies Endpoints
// -------------------------------------------------------------

// GET /api/studies -> list with computed forecast per study
app.get('/api/studies', (req, res) => {
  try {
    const studies = db.prepare('SELECT * FROM studies ORDER BY id ASC').all();
    const result = studies.map(s => {
      const forecast = computeForecast(s);
      return {
        ...s,
        forecast
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/studies/:id -> full drill-down: study + milestones + notes + documents + consent_summary
app.get('/api/studies/:id', (req, res) => {
  try {
    const study = db.prepare('SELECT * FROM studies WHERE id = ?').get(req.params.id);
    if (!study) {
      return res.status(404).json({ error: `Study ${req.params.id} not found.` });
    }

    const forecast = computeForecast(study);
    const milestones = db.prepare('SELECT * FROM milestones WHERE study_id = ? ORDER BY due_date ASC').all(study.id);
    const notes = db.prepare('SELECT * FROM notes WHERE study_id = ? ORDER BY created_at DESC').all(study.id);
    const documents = db.prepare('SELECT id, study_id, filename, category, uploaded_by, uploaded_at, file_data FROM documents WHERE study_id = ? ORDER BY uploaded_at DESC').all(study.id);
    
    // Consent summary
    const participants = db.prepare('SELECT * FROM participants WHERE study_id = ?').all(study.id);
    const totalParticipants = participants.length;
    const consentedParticipants = participants.filter(p => p.consent_obtained === 1).length;
    const pendingParticipants = participants.filter(p => p.consent_obtained === 0);

    const consent_summary = {
      total: totalParticipants,
      consented: consentedParticipants,
      pending: pendingParticipants.length,
      compliance_rate: totalParticipants > 0 ? Math.round((consentedParticipants / totalParticipants) * 100) : 100,
      active_versions: [...new Set(participants.map(p => p.consent_version).filter(Boolean))]
    };

    // Associated AEs for study drilldown
    const adverse_events = db.prepare('SELECT * FROM adverse_events WHERE study_id = ? ORDER BY reported_date DESC').all(study.id);

    res.json({
      study: {
        ...study,
        forecast
      },
      milestones,
      notes,
      documents,
      consent_summary,
      participants,
      adverse_events
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/studies/:id/notes (auth required, any clinical/research role: pi, coordinator, monitor, ethics, pv, admin)
app.post('/api/studies/:id/notes', authenticate, requireRoles('pi', 'coordinator', 'monitor', 'ethics', 'pv', 'admin'), (req, res) => {
  try {
    const { body } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Note body content is required.' });
    }

    const study = db.prepare('SELECT id FROM studies WHERE id = ?').get(req.params.id);
    if (!study) {
      return res.status(404).json({ error: 'Study not found.' });
    }

    const id = `NOTE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const created_at = new Date().toISOString();
    const author = req.user.name;

    db.prepare(`
      INSERT INTO notes (id, study_id, author, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, study.id, author, body.trim(), created_at);

    insertAuditLog({
      user_name: req.user.name,
      action: 'ADD_RESEARCHER_NOTE',
      entity_type: 'NOTE',
      entity_id: id,
      alcoa_tags: 'Attributable, Contemporaneous, Original'
    });

    res.status(201).json({
      message: 'Note recorded successfully.',
      note: { id, study_id: study.id, author, body: body.trim(), created_at }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/studies/:id/documents (auth required, roles: pi, coordinator, ethics, admin)
app.post('/api/studies/:id/documents', authenticate, requireRoles('pi', 'coordinator', 'ethics', 'admin'), (req, res) => {
  try {
    const { filename, category, file_data } = req.body;
    if (!filename || !category) {
      return res.status(400).json({ error: 'Filename and category are required.' });
    }

    const validCategories = ['protocol', 'consent_form', 'ae_photo', 'regulatory', 'other'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
    }

    const study = db.prepare('SELECT id FROM studies WHERE id = ?').get(req.params.id);
    if (!study) {
      return res.status(404).json({ error: 'Study not found.' });
    }

    const id = `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const uploaded_at = new Date().toISOString();
    const uploaded_by = req.user.name;

    db.prepare(`
      INSERT INTO documents (id, study_id, filename, category, uploaded_by, uploaded_at, file_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, study.id, filename, category, uploaded_by, uploaded_at, file_data || null);

    insertAuditLog({
      user_name: req.user.name,
      action: 'UPLOAD_STUDY_DOCUMENT',
      entity_type: 'DOCUMENT',
      entity_id: id,
      alcoa_tags: 'Attributable, Contemporaneous, Enduring, Complete'
    });

    res.status(201).json({
      message: 'Document uploaded successfully.',
      document: { id, study_id: study.id, filename, category, uploaded_by, uploaded_at }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/studies/:id/stage (auth required, roles: pi, coordinator, admin)
app.put('/api/studies/:id/stage', authenticate, requireRoles('pi', 'coordinator', 'admin'), (req, res) => {
  try {
    const { stage, status } = req.body;
    const validStages = ['protocol_iec', 'ctri_registration', 'site_activation', 'screening', 'enrollment', 'randomization', 'ongoing', 'close_out'];
    
    if (stage && !validStages.includes(stage)) {
      return res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
    }

    const study = db.prepare('SELECT * FROM studies WHERE id = ?').get(req.params.id);
    if (!study) {
      return res.status(404).json({ error: 'Study not found.' });
    }

    const newStage = stage || study.stage;
    const newStatus = status || study.status;

    db.prepare('UPDATE studies SET stage = ?, status = ? WHERE id = ?').run(newStage, newStatus, study.id);

    insertAuditLog({
      user_name: req.user.name,
      action: 'UPDATE_STUDY_STAGE',
      entity_type: 'STUDY',
      entity_id: study.id,
      alcoa_tags: 'Attributable, Contemporaneous, Accurate'
    });

    broadcast('kpi_update', { study_id: study.id, stage: newStage, status: newStatus });

    res.json({ message: 'Study stage updated successfully.', study_id: study.id, stage: newStage, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/milestones/:id/sign (auth required, role: pi -> e-signing milestone)
app.post('/api/milestones/:id/sign', authenticate, requireRoles('pi'), (req, res) => {
  try {
    const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(req.params.id);
    if (!milestone) {
      return res.status(404).json({ error: 'Milestone not found.' });
    }

    const now = new Date().toISOString();
    const signer = req.user.name;

    db.prepare(`
      UPDATE milestones 
      SET status = 'done', completed_date = ?, e_signed_by = ?, e_signed_at = ?
      WHERE id = ?
    `).run(now.split('T')[0], signer, now, milestone.id);

    insertAuditLog({
      user_name: signer,
      action: 'E_SIGN_MILESTONE',
      entity_type: 'MILESTONE',
      entity_id: milestone.id,
      alcoa_tags: 'Attributable, Legible, Contemporaneous, Original, Enduring'
    });

    broadcast('kpi_update', { type: 'milestone_signed', id: milestone.id, signer, signed_at: now });

    res.json({
      message: 'Milestone successfully completed and e-signed.',
      milestone: {
        id: milestone.id,
        status: 'done',
        completed_date: now.split('T')[0],
        e_signed_by: signer,
        e_signed_at: now
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3. Adverse Events & MedDRA / WHODrug Coding
// -------------------------------------------------------------

// POST /api/code-suggest { text } -> live coding suggestion, no DB write, used for AE form & n8n voice pipeline
app.post('/api/code-suggest', (req, res) => {
  try {
    const { text } = req.body;
    const suggestion = suggestCodes(text || '');
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/adverse-events
app.get('/api/adverse-events', (req, res) => {
  try {
    const aes = db.prepare(`
      SELECT ae.*, s.title as study_title, s.phase as study_phase
      FROM adverse_events ae
      LEFT JOIN studies s ON ae.study_id = s.id
      ORDER BY ae.severity = 'serious' DESC, ae.reported_date DESC
    `).all();
    res.json(aes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/adverse-events
// Auth required UNLESS source=voice_report, in which case no login needed by design
// Permitted roles for staff-entered reports: pv, coordinator, monitor, admin
// Auto-runs MedDRA/WHODrug coding suggestion on submission!
app.post('/api/adverse-events', optionalAuthenticate, (req, res) => {
  try {
    const {
      study_id,
      participant_id,
      description,
      severity,
      meddra_code,
      meddra_label,
      whodrug_code,
      source
    } = req.body;

    const reportSource = source === 'voice_report' ? 'voice_report' : 'staff';

    // Verify auth if not voice report
    if (reportSource === 'staff') {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required for staff-entered adverse event reports.' });
      }
      const allowedRoles = ['pv', 'coordinator', 'monitor', 'admin'];
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: `Forbidden: Role '${req.user.role}' cannot submit staff adverse event reports.` });
      }
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Adverse event description is required.' });
    }

    // Auto-suggest codes if not provided
    const suggestions = suggestCodes(description);
    const finalMeddraCode = meddra_code || suggestions.meddra_code;
    const finalMeddraLabel = meddra_label || suggestions.meddra_label;
    const finalWhodrugCode = whodrug_code || suggestions.whodrug_code;
    const finalSeverity = severity || suggestions.severity;

    // Verify foreign keys or fallback to first active study/participant for voice reporting demo
    let finalStudyId = study_id;
    let finalParticipantId = participant_id;

    if (!finalStudyId) {
      const defaultStudy = db.prepare("SELECT id FROM studies WHERE status != 'close_out' LIMIT 1").get();
      finalStudyId = defaultStudy ? defaultStudy.id : 'AIIA-GUDU-03';
    }

    if (!finalParticipantId) {
      const defaultPart = db.prepare('SELECT id FROM participants WHERE study_id = ? LIMIT 1').get(finalStudyId);
      finalParticipantId = defaultPart ? defaultPart.id : 'PT-GUDU-201';
    }

    const id = `AE-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`;
    const reported_date = new Date().toISOString().split('T')[0];

    // CDSCO / Schedule Y / CT Rules 2019 reporting deadline: 24h for serious, 14 days for others
    const deadlineHours = finalSeverity === 'serious' ? 24 : 336;
    const report_deadline = new Date(Date.now() + (deadlineHours * 3600 * 1000)).toISOString();
    const status = 'open';

    db.prepare(`
      INSERT INTO adverse_events (id, study_id, participant_id, description, severity, meddra_code, meddra_label, whodrug_code, reported_date, report_deadline, status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, finalStudyId, finalParticipantId, description.trim(), finalSeverity,
      finalMeddraCode, finalMeddraLabel, finalWhodrugCode, reported_date,
      report_deadline, status, reportSource
    );

    const reporterName = req.user ? req.user.name : `Public / Field Health Worker (${reportSource})`;

    const auditEntry = insertAuditLog({
      user_name: reporterName,
      action: finalSeverity === 'serious' ? 'REPORT_CRITICAL_SAE' : 'REPORT_ADVERSE_EVENT',
      entity_type: 'ADVERSE_EVENT',
      entity_id: id,
      alcoa_tags: 'Attributable, Contemporaneous, Original, Accurate, Complete'
    });

    const newAe = {
      id,
      study_id: finalStudyId,
      participant_id: finalParticipantId,
      description: description.trim(),
      severity: finalSeverity,
      meddra_code: finalMeddraCode,
      meddra_label: finalMeddraLabel,
      whodrug_code: finalWhodrugCode,
      reported_date,
      report_deadline,
      status,
      source: reportSource
    };

    // If serious, flag for immediate PV on-call page
    const pvPagingAlert = finalSeverity === 'serious' ? {
      alert: 'URGENT_PV_ON_CALL_PAGING_TRIGGERED',
      message: `Serious Adverse Event ${id} recorded under ${finalStudyId}. Statutory 24-hr CDSCO clock initiated. Immediate notification dispatched to Dr. Shalini Deshmukh (NPvCC).`,
      regulatory_deadline: report_deadline,
      contact: 'npvcc-safety@aiia.gov.in / +91-11-29948605'
    } : null;

    // Broadcast live to all connected role dashboards via SSE!
    broadcast('adverse_event', { ae: newAe, pv_paging: pvPagingAlert });

    res.status(201).json({
      message: 'Adverse event recorded successfully.',
      adverse_event: newAe,
      pv_paging_alert: pvPagingAlert,
      audit_log: auditEntry
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4. Audit Trail & Natural Language Engine
// -------------------------------------------------------------

// GET /api/audit-logs
app.get('/api/audit-logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ask { question } -> Ask-the-CTMS natural language query engine
app.post('/api/ask', (req, res) => {
  try {
    const { question } = req.body;
    const response = askCtms(question);
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5. Leadership & Portfolio Rollup
// -------------------------------------------------------------

// GET /api/dashboard/leadership -> portfolio-wide rollup
app.get('/api/dashboard/leadership', (req, res) => {
  try {
    const totalStudies = db.prepare('SELECT COUNT(*) as count FROM studies').get().count;
    const atRiskCount = db.prepare("SELECT COUNT(*) as count FROM studies WHERE status = 'risk'").get().count;
    const watchCount = db.prepare("SELECT COUNT(*) as count FROM studies WHERE status = 'watch'").get().count;
    const okCount = db.prepare("SELECT COUNT(*) as count FROM studies WHERE status = 'ok'").get().count;

    const openAes = db.prepare("SELECT COUNT(*) as count FROM adverse_events WHERE status = 'open'").get().count;
    const seriousAes = db.prepare("SELECT COUNT(*) as count FROM adverse_events WHERE severity = 'serious' AND status = 'open'").get().count;

    const stagesGroup = db.prepare('SELECT stage, COUNT(*) as count FROM studies GROUP BY stage').all();

    const studies = db.prepare('SELECT * FROM studies').all();
    let totalEnrolled = 0;
    let totalTarget = 0;
    for (const s of studies) {
      totalEnrolled += s.enrolled;
      totalTarget += s.enrollment_target;
    }

    res.json({
      portfolio_summary: {
        total_studies: totalStudies,
        at_risk_count: atRiskCount,
        watch_count: watchCount,
        ok_count: okCount,
        open_aes: openAes,
        serious_aes: seriousAes,
        total_enrolled: totalEnrolled,
        total_target: totalTarget,
        portfolio_enrollment_rate: totalTarget > 0 ? Math.round((totalEnrolled / totalTarget) * 100) : 0
      },
      studies_grouped_by_stage: stagesGroup,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attention -> Cross-portfolio "needs attention" view
app.get('/api/attention', (req, res) => {
  try {
    const urgentAes = db.prepare(`
      SELECT ae.*, s.title as study_title 
      FROM adverse_events ae
      JOIN studies s ON ae.study_id = s.id
      WHERE ae.status = 'open' AND ae.severity = 'serious'
    `).all();

    const overdueMilestones = db.prepare(`
      SELECT m.*, s.title as study_title
      FROM milestones m
      JOIN studies s ON m.study_id = s.id
      WHERE m.status = 'overdue'
    `).all();

    const riskStudies = db.prepare("SELECT * FROM studies WHERE status = 'risk'").all();
    const highQueryStudies = db.prepare("SELECT * FROM studies WHERE open_data_queries >= 10").all();

    res.json({
      urgent_aes: urgentAes,
      overdue_milestones: overdueMilestones,
      risk_studies: riskStudies,
      high_query_studies: highQueryStudies,
      total_attention_items: urgentAes.length + overdueMilestones.length + riskStudies.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 6. Real-time SSE Stream
// -------------------------------------------------------------

// GET /api/stream -> Server-Sent Events feed
app.get('/api/stream', (req, res) => {
  registerClient(req, res);
});

// -------------------------------------------------------------
// 7. Auxiliary Endpoints (Participants, Users)
// -------------------------------------------------------------

// GET /api/participants
app.get('/api/participants', (req, res) => {
  try {
    const participants = db.prepare(`
      SELECT p.*, s.title as study_title 
      FROM participants p
      JOIN studies s ON p.study_id = s.id
      ORDER BY p.enrolled_date DESC
    `).all();
    res.json(participants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/participants/:id/consent (coordinator, pi, admin)
app.post('/api/participants/:id/consent', authenticate, requireRoles('coordinator', 'pi', 'admin'), (req, res) => {
  try {
    const { version } = req.body;
    const now = new Date().toISOString().split('T')[0];
    const consentVer = version || 'v2.1';

    db.prepare(`
      UPDATE participants
      SET consent_obtained = 1, consent_date = ?, consent_version = ?
      WHERE id = ?
    `).run(now, consentVer, req.params.id);

    insertAuditLog({
      user_name: req.user.name,
      action: 'RECORD_PARTICIPANT_CONSENT',
      entity_type: 'PARTICIPANT',
      entity_id: req.params.id,
      alcoa_tags: 'Attributable, Contemporaneous, Original, Accurate'
    });

    broadcast('kpi_update', { type: 'consent_recorded', participant_id: req.params.id, consent_date: now });

    res.json({ message: 'Consent documented successfully.', participant_id: req.params.id, consent_version: consentVer, consent_date: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users (admin only)
app.get('/api/users', authenticate, requireRoles('admin'), (req, res) => {
  try {
    const users = db.prepare('SELECT id, name, email, role FROM users ORDER BY name ASC').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users (admin only)
app.post('/api/users', authenticate, requireRoles('admin'), (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required.' });
    }

    const validRoles = ['pi', 'coordinator', 'monitor', 'ethics', 'pv', 'admin', 'regulator', 'leadership'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const { hash, salt } = hashPassword(password);
    const id = `usr-${Date.now()}`;

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, password_salt, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), email.trim().toLowerCase(), hash, salt, role);

    insertAuditLog({
      user_name: req.user.name,
      action: 'CREATE_USER_ACCOUNT',
      entity_type: 'USER',
      entity_id: id,
      alcoa_tags: 'Attributable, Contemporaneous, Enduring'
    });

    res.status(201).json({ message: 'User created successfully.', user: { id, name, email, role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start listening if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 TrialSetu CTMS running at http://localhost:${PORT}`);
    console.log(`🏛️  AIIA (All India Institute of Ayurveda) - SIH PS26046`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
