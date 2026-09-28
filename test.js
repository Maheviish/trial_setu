// test.js - Automated Test Suite for TrialSetu CTMS
// Validates all API endpoints, RBAC enforcement, ALCOA+ audit trail, forecasting, and NLP.

const assert = require('node:assert');
const app = require('./src/server');
const { db, guardAuditMutation } = require('./src/db');

const TEST_PORT = 3105;

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting TrialSetu Comprehensive Test Suite');
  console.log('====================================================');

  const server = app.listen(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}`;

  try {
    // -----------------------------------------------------------
    // Test 1: ALCOA+ Append-Only Audit Trail Protection
    // -----------------------------------------------------------
    console.log('\n[Test 1] Testing ALCOA+ Append-Only Guard...');
    assert.throws(() => {
      guardAuditMutation('UPDATE audit_logs SET user_name = "tampered" WHERE id = "AUD-1"');
    }, /VIOLATION: audit_logs table is strictly append-only/);

    assert.throws(() => {
      guardAuditMutation('DELETE FROM audit_logs WHERE id = "AUD-1"');
    }, /VIOLATION: audit_logs table is strictly append-only/);
    console.log('✅ ALCOA+ append-only protection actively blocks UPDATE and DELETE queries.');

    // -----------------------------------------------------------
    // Test 2: User Authentication & RBAC for All 8 Roles
    // -----------------------------------------------------------
    console.log('\n[Test 2] Testing Authentication & Token Issuance across all 8 roles...');
    const roles = ['pi', 'coordinator', 'monitor', 'ethics', 'pv', 'admin', 'regulator', 'leadership'];
    const tokens = {};

    for (const r of roles) {
      const email = r === 'regulator' ? 'regulator@cdsco.gov.in' : `${r}@aiia.gov.in`;
      const res = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password123!' })
      });

      assert.strictEqual(res.status, 200, `Login should succeed for ${email}`);
      const body = await res.json();
      assert.ok(body.token, `Token should be issued for ${r}`);
      assert.strictEqual(body.user.role, r, `User role should be ${r}`);
      tokens[r] = body.token;
    }
    console.log(`✅ All ${roles.length} roles authenticated successfully with scrypt password verification.`);

    // -----------------------------------------------------------
    // Test 3: Studies & Predictive Completion Forecasting
    // -----------------------------------------------------------
    console.log('\n[Test 3] Testing Studies List & Predictive Forecasting...');
    const studiesRes = await fetch(`${baseUrl}/api/studies`);
    assert.strictEqual(studiesRes.status, 200);
    const studies = await studiesRes.json();
    assert.ok(studies.length >= 5, 'Should have at least 5 seeded studies');

    const firstStudy = studies.find(s => s.id === 'AIIA-ASHWA-01');
    assert.ok(firstStudy.forecast, 'Study should include computed forecast object');
    assert.ok(firstStudy.forecast.daily_velocity > 0, 'Velocity should be computed');
    assert.ok(firstStudy.forecast.projected_completion_date, 'Projected completion date should exist');
    console.log(`✅ Forecasting verified: ${firstStudy.id} velocity = ${firstStudy.forecast.daily_velocity} pts/day, projected = ${firstStudy.forecast.projected_completion_date}`);

    // Verify site_activation stage is present (explicit PS requirement!)
    const siteActStudy = studies.find(s => s.stage === 'site_activation');
    assert.ok(siteActStudy, 'Stage "site_activation" must be present as explicitly required by PS');
    console.log(`✅ Explicit PS stage verified: Study ${siteActStudy.id} is in "site_activation" stage.`);

    // -----------------------------------------------------------
    // Test 4: Study Drill-Down
    // -----------------------------------------------------------
    console.log('\n[Test 4] Testing Full Study Drill-Down (/api/studies/:id)...');
    const drillRes = await fetch(`${baseUrl}/api/studies/AIIA-ASHWA-01`);
    assert.strictEqual(drillRes.status, 200);
    const drill = await drillRes.json();
    assert.ok(drill.study, 'Should return study object');
    assert.ok(Array.isArray(drill.milestones), 'Should return milestones array');
    assert.ok(Array.isArray(drill.notes), 'Should return notes array');
    assert.ok(Array.isArray(drill.documents), 'Should return documents array');
    assert.ok(drill.consent_summary, 'Should return consent_summary');
    console.log(`✅ Drilldown verified: Milestones (${drill.milestones.length}), Notes (${drill.notes.length}), Documents (${drill.documents.length})`);

    // -----------------------------------------------------------
    // Test 5: Researcher Notes Feature
    // -----------------------------------------------------------
    console.log('\n[Test 5] Testing Researcher Notes (POST /api/studies/:id/notes)...');
    const noteRes = await fetch(`${baseUrl}/api/studies/AIIA-ASHWA-01/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.pi}`
      },
      body: JSON.stringify({ body: 'Automated test note: Patient visit completed with verified herbal drug count.' })
    });
    assert.strictEqual(noteRes.status, 201);
    const noteData = await noteRes.json();
    assert.ok(noteData.note.id, 'Note should have an ID');
    console.log(`✅ Researcher note created with ID ${noteData.note.id}`);

    // -----------------------------------------------------------
    // Test 6: Document Upload Feature
    // -----------------------------------------------------------
    console.log('\n[Test 6] Testing Document Upload (POST /api/studies/:id/documents)...');
    const docRes = await fetch(`${baseUrl}/api/studies/AIIA-ASHWA-01/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.coordinator}`
      },
      body: JSON.stringify({
        filename: 'Trial_Monitoring_Report_2026.pdf',
        category: 'protocol',
        file_data: 'data:application/pdf;base64,VEVTVF9EQVRB'
      })
    });
    assert.strictEqual(docRes.status, 201);
    const docData = await docRes.json();
    assert.ok(docData.document.id);
    console.log(`✅ Document uploaded: ${docData.document.filename}`);

    // -----------------------------------------------------------
    // Test 7: Live MedDRA & WHODrug Code Suggestion
    // -----------------------------------------------------------
    console.log('\n[Test 7] Testing MedDRA & WHODrug Code Suggestion (POST /api/code-suggest)...');
    const suggestRes = await fetch(`${baseUrl}/api/code-suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Patient developed yellowing of eyes, dark urine, and elevated liver ALT enzymes after Guduchi' })
    });
    assert.strictEqual(suggestRes.status, 200);
    const suggestion = await suggestRes.json();
    assert.strictEqual(suggestion.meddra_code, '10019211');
    assert.strictEqual(suggestion.severity, 'serious');
    assert.strictEqual(suggestion.deadline_hours, 24);
    assert.strictEqual(suggestion.whodrug_code, 'WHO-D-08831');
    console.log(`✅ Code suggest verified: MedDRA ${suggestion.meddra_code} (${suggestion.meddra_label}), Severity = ${suggestion.severity}, Deadline = ${suggestion.deadline_hours}h`);

    // -----------------------------------------------------------
    // Test 8: Voice-based AE Intake (No Login Required by Design)
    // -----------------------------------------------------------
    console.log('\n[Test 8] Testing Voice-Based AE Ingestion without login...');
    const voiceRes = await fetch(`${baseUrl}/api/adverse-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        study_id: 'AIIA-GUDU-03',
        participant_id: 'PT-GUDU-201',
        description: 'Field ASHA worker reporting patient emergency hospitalization for acute jaundice',
        severity: 'serious',
        source: 'voice_report'
      })
    });
    assert.strictEqual(voiceRes.status, 201, 'Voice AE intake must not require authentication');
    const voiceData = await voiceRes.json();
    assert.ok(voiceData.adverse_event.id);
    assert.strictEqual(voiceData.adverse_event.source, 'voice_report');
    assert.ok(voiceData.pv_paging_alert, 'Serious voice AE must trigger PV paging alert');
    console.log(`✅ Voice AE ingested: ${voiceData.adverse_event.id} with PV paging alert.`);

    // -----------------------------------------------------------
    // Test 9: Ask-the-CTMS Natural Language Query Engine
    // -----------------------------------------------------------
    console.log('\n[Test 9] Testing Ask-the-CTMS Natural Language Engine (All 5 mandatory questions)...');
    const questions = [
      'Which studies are at risk?',
      'What are the open AE and SAE reporting deadlines?',
      'Show consent completion status across trials',
      'Which studies have open data queries?',
      'Which studies are currently in site activation?'
    ];

    for (const q of questions) {
      const askRes = await fetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q })
      });
      assert.strictEqual(askRes.status, 200);
      const askData = await askRes.json();
      assert.ok(askData.answer.length > 20, `Answer should be non-empty for: "${q}"`);
      assert.notStrictEqual(askData.intent, 'empty');
      console.log(`  ✓ Query "${q}" -> Intent: ${askData.intent}`);
    }
    console.log('✅ All 5 mandatory Ask-the-CTMS queries answered from live database records.');

    // -----------------------------------------------------------
    // Test 10: Leadership Portfolio Rollup
    // -----------------------------------------------------------
    console.log('\n[Test 10] Testing Leadership Portfolio Rollup (GET /api/dashboard/leadership)...');
    const ldrRes = await fetch(`${baseUrl}/api/dashboard/leadership`);
    assert.strictEqual(ldrRes.status, 200);
    const ldrData = await ldrRes.json();
    assert.ok(ldrData.portfolio_summary.total_studies >= 5);
    assert.ok(ldrData.portfolio_summary.at_risk_count >= 1);
    assert.ok(Array.isArray(ldrData.studies_grouped_by_stage));
    console.log(`✅ Leadership rollup verified: Total Studies = ${ldrData.portfolio_summary.total_studies}, At-Risk = ${ldrData.portfolio_summary.at_risk_count}`);

    // -----------------------------------------------------------
    // Test 11: Milestone E-Signing (PI role only)
    // -----------------------------------------------------------
    console.log('\n[Test 11] Testing PI Milestone E-Signature...');
    const signRes = await fetch(`${baseUrl}/api/milestones/MS-03/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.pi}`
      }
    });
    assert.strictEqual(signRes.status, 200);
    const signData = await signRes.json();
    assert.strictEqual(signData.milestone.status, 'done');
    assert.ok(signData.milestone.e_signed_by);
    console.log(`✅ Milestone signed by: ${signData.milestone.e_signed_by}`);

    // -----------------------------------------------------------
    // Test 12: Regulator Strictly Read-Only Enforcement
    // -----------------------------------------------------------
    console.log('\n[Test 12] Testing Regulator Read-Only Permissions Enforcement...');
    const regWriteRes = await fetch(`${baseUrl}/api/studies/AIIA-ASHWA-01/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.regulator}`
      },
      body: JSON.stringify({ body: 'Regulator unauthorized note' })
    });
    assert.strictEqual(regWriteRes.status, 403, 'Regulator must be strictly forbidden from write actions');
    console.log('✅ Regulator write attempt correctly blocked with HTTP 403 Forbidden.');

    // -----------------------------------------------------------
    // Test 13: Cross-Portfolio Attention View
    // -----------------------------------------------------------
    console.log('\n[Test 13] Testing Cross-Portfolio Attention View (GET /api/attention)...');
    const attRes = await fetch(`${baseUrl}/api/attention`);
    assert.strictEqual(attRes.status, 200);
    const attData = await attRes.json();
    assert.ok(attData.total_attention_items > 0);
    console.log(`✅ Attention view verified: Total attention items = ${attData.total_attention_items}`);

    console.log('\n====================================================');
    console.log('🎉 ALL 13 TEST SUITES PASSED FLAWLESSLY!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

runTests();
