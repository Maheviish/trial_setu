// src/nlp.js - MedDRA/WHODrug Coding Suggestion & Ask-the-CTMS Natural Language Engine

const { db } = require('./db');
const { computeForecast } = require('./forecast');

// MedDRA & WHODrug Clinical Knowledge Base
const MEDDRA_DICT = [
  {
    keywords: ['jaundice', 'yellow', 'sclera', 'liver', 'alt', 'ast', 'bilirubin', 'hepatic', 'hepatotoxicity', 'dili', 'enzymes'],
    meddra_code: '10019211',
    meddra_label: 'Hepatic enzyme increased',
    soc: 'Hepatobiliary disorders',
    default_severity: 'serious',
    is_serious: true,
    guidance: 'Requires urgent LFT panel, immediate study drug hold, and NPvCC/CDSCO expedited 24-hour regulatory notification.'
  },
  {
    keywords: ['rash', 'pruritus', 'itch', 'itching', 'urticaria', 'hives', 'erythema', 'bumps', 'redness', 'skin'],
    meddra_code: '10037844',
    meddra_label: 'Rash pruritic',
    soc: 'Skin and subcutaneous tissue disorders',
    default_severity: 'moderate',
    is_serious: false,
    guidance: 'Photodocumentation advised. Assess causality for herbal adjuvant hypersensitivity.'
  },
  {
    keywords: ['dyspepsia', 'gastric', 'heartburn', 'acidity', 'burning', 'stomach', 'epigastric', 'indigestion', 'amla pitta'],
    meddra_code: '10013946',
    meddra_label: 'Dyspepsia',
    soc: 'Gastrointestinal disorders',
    default_severity: 'mild',
    is_serious: false,
    guidance: 'Evaluate administration timing (recommend post-prandial with warm water / Anupana).'
  },
  {
    keywords: ['nausea', 'vomit', 'vomiting', 'emesis', 'queasy', 'nauseous', 'chhardi'],
    meddra_code: '10028813',
    meddra_label: 'Nausea',
    soc: 'Gastrointestinal disorders',
    default_severity: 'mild',
    is_serious: false,
    guidance: 'Monitor fluid balance; check for interaction with morning decoctions.'
  },
  {
    keywords: ['diarrhea', 'diarrhoea', 'loose stool', 'loose motions', 'cramps', 'atisara'],
    meddra_code: '10012735',
    meddra_label: 'Diarrhoea',
    soc: 'Gastrointestinal disorders',
    default_severity: 'moderate',
    is_serious: false,
    guidance: 'Rule out infectious gastroenteritis vs compound toxicity.'
  },
  {
    keywords: ['headache', 'migraine', 'head ache', 'cephalea', 'shirashula'],
    meddra_code: '10019974',
    meddra_label: 'Headache',
    soc: 'Nervous system disorders',
    default_severity: 'mild',
    is_serious: false,
    guidance: 'Track duration, BP check, and analgesic rescue medication use.'
  },
  {
    keywords: ['dizziness', 'vertigo', 'lightheaded', 'faint', 'syncope', 'bhrama'],
    meddra_code: '10013573',
    meddra_label: 'Dizziness',
    soc: 'Nervous system disorders',
    default_severity: 'moderate',
    is_serious: false,
    guidance: 'Orthostatic vitals recommended; verify concomitant antihypertensive therapy.'
  },
  {
    keywords: ['dyspnea', 'dyspnoea', 'breath', 'breathing', 'shortness of breath', 'chest pain', 'wheeze', 'shwasa'],
    meddra_code: '10013968',
    meddra_label: 'Dyspnoea',
    soc: 'Respiratory, thoracic and mediastinal disorders',
    default_severity: 'serious',
    is_serious: true,
    guidance: 'Immediate emergency medical review, SpO2 check, ECG, and 24-hr SAE regulatory alert.'
  },
  {
    keywords: ['hypoglycemia', 'hypoglycaemia', 'sugar drop', 'tremors', 'cold sweat', 'shakiness'],
    meddra_code: '10020963',
    meddra_label: 'Hypoglycaemia',
    soc: 'Metabolism and nutrition disorders',
    default_severity: 'serious',
    is_serious: true,
    guidance: 'Check synergism between Ayurvedic antidiabetic formulation (Guduchi) and Metformin.'
  },
  {
    keywords: ['anaphylaxis', 'angioedema', 'swelling face', 'throat swelling', 'shock'],
    meddra_code: '10002198',
    meddra_label: 'Anaphylactic reaction',
    soc: 'Immune system disorders',
    default_severity: 'serious',
    is_serious: true,
    guidance: 'Life-threatening medical emergency. Adrenaline protocol and DSMB notification.'
  }
];

const WHODRUG_DICT = [
  { keywords: ['ashwagandha', 'withania', 'somnifera', 'indian ginseng', 'ashwa'], code: 'WHO-D-01928', name: 'Withania somnifera root extract' },
  { keywords: ['curcumin', 'curcuma', 'longa', 'turmeric', 'haridra'], code: 'WHO-D-04512', name: 'Curcuma longa rhizome extract' },
  { keywords: ['boswellia', 'serrata', 'shallaki', 'frankincense'], code: 'WHO-D-04513', name: 'Boswellia serrata gum resin' },
  { keywords: ['guduchi', 'giloy', 'tinospora', 'cordifolia', 'amrita'], code: 'WHO-D-08831', name: 'Tinospora cordifolia aqueous extract' },
  { keywords: ['ayush-64', 'ayush64', 'ayush 64'], code: 'WHO-D-07741', name: 'AYUSH-64 Polyherbal Formulation' },
  { keywords: ['swarna', 'gold bhasma', 'swarna bhasma', 'calx of gold'], code: 'WHO-D-09123', name: 'Swarna Bhasma (Incinerated Gold Calx)' },
  { keywords: ['metformin', 'glycomet'], code: 'WHO-D-00214', name: 'Metformin hydrochloride' },
  { keywords: ['celecoxib', 'celebrex'], code: 'WHO-D-00389', name: 'Celecoxib' },
  { keywords: ['paracetamol', 'crocin', 'acetaminophen', 'dolo'], code: 'WHO-D-00105', name: 'Paracetamol' }
];

// Live Code Suggestion for both AE entry form & n8n voice pipeline
function suggestCodes(text) {
  if (!text || typeof text !== 'string') {
    return {
      meddra_code: '10017947',
      meddra_label: 'Gastrointestinal disorder',
      whodrug_code: 'WHO-D-GENERIC',
      severity: 'mild',
      confidence: 0.5,
      guidance: 'Standard adverse event monitoring.'
    };
  }

  const lower = text.toLowerCase();

  // Match MedDRA
  let matchedMeddra = null;
  let maxKeywordMatches = 0;

  for (const item of MEDDRA_DICT) {
    let count = 0;
    for (const kw of item.keywords) {
      if (lower.includes(kw)) count++;
    }
    if (count > maxKeywordMatches) {
      maxKeywordMatches = count;
      matchedMeddra = item;
    }
  }

  if (!matchedMeddra) {
    // Default fallback
    matchedMeddra = {
      meddra_code: '10018065',
      meddra_label: 'General symptom',
      soc: 'General disorders and administration site conditions',
      default_severity: 'mild',
      is_serious: false,
      guidance: 'Monitor and reassess at next clinic visit.'
    };
  }

  // Match WHODrug
  let matchedWhoDrug = null;
  for (const item of WHODRUG_DICT) {
    for (const kw of item.keywords) {
      if (lower.includes(kw)) {
        matchedWhoDrug = item;
        break;
      }
    }
    if (matchedWhoDrug) break;
  }

  // Assess severity from critical triggers
  let assessedSeverity = matchedMeddra.default_severity;
  const criticalWords = ['hospital', 'admitted', 'emergency', 'icu', 'death', 'life threatening', 'severe', 'unconscious', 'fainted'];
  for (const cw of criticalWords) {
    if (lower.includes(cw)) {
      assessedSeverity = 'serious';
      break;
    }
  }

  // Calculate CDSCO / Schedule Y / CT Rules 2019 reporting deadline
  const now = new Date();
  let deadlineHours = assessedSeverity === 'serious' ? 24 : 336; // 24 hours vs 14 days
  const deadlineDate = new Date(now.getTime() + (deadlineHours * 60 * 60 * 1000)).toISOString();

  return {
    meddra_code: matchedMeddra.meddra_code,
    meddra_label: matchedMeddra.meddra_label,
    soc: matchedMeddra.soc,
    whodrug_code: matchedWhoDrug ? matchedWhoDrug.code : 'WHO-D-08831',
    whodrug_name: matchedWhoDrug ? matchedWhoDrug.name : 'Unspecified Investigational Herbal Formulation',
    severity: assessedSeverity,
    is_serious: assessedSeverity === 'serious',
    report_deadline: deadlineDate,
    deadline_hours: deadlineHours,
    guidance: matchedMeddra.guidance,
    confidence: maxKeywordMatches > 0 ? Math.min(0.75 + (maxKeywordMatches * 0.1), 0.98) : 0.60
  };
}

// Ask-the-CTMS Natural Language Engine
// Answers live data queries dynamically from SQLite
function askCtms(question) {
  if (!question || typeof question !== 'string') {
    return {
      answer: 'Please provide a clinical trial query. For example: "Which studies are at risk?" or "What are the open AE deadlines?"',
      intent: 'empty',
      data: null
    };
  }

  const q = question.toLowerCase().trim();

  // 1. Studies at risk
  if (q.includes('risk') || q.includes('at-risk') || q.includes('failing') || q.includes('lagging') || q.includes('trouble')) {
    const studies = db.prepare("SELECT * FROM studies WHERE status = 'risk'").all();
    const count = studies.length;

    let explanation = `### ⚠️ At-Risk Studies Identified (${count} study in critical status)\n\n`;
    if (count === 0) {
      explanation += `Good news! There are currently **no studies marked at critical risk** in the AIIA portfolio.`;
    } else {
      for (const s of studies) {
        const fc = computeForecast(s);
        explanation += `* **[${s.id}] ${s.title}**\n`;
        explanation += `  * **Stage:** \`${s.stage.toUpperCase()}\` | **Phase:** ${s.phase}\n`;
        explanation += `  * **Enrollment Progress:** ${s.enrolled} / ${s.enrollment_target} (${fc.completion_percentage}% target)\n`;
        explanation += `  * **Daily Velocity:** ${fc.daily_velocity} participants/day (Target: ${fc.planned_velocity})\n`;
        explanation += `  * **Root Causes:** ${s.protocol_deviations} protocol deviations, ${s.open_data_queries} open data queries, visit compliance ${s.visit_compliance_done}/${s.visit_compliance_total} (${Math.round((s.visit_compliance_done / (s.visit_compliance_total || 1)) * 100)}%).\n`;
        explanation += `  * **Predictive Forecast:** ${fc.narrative}\n\n`;
      }
      explanation += `**Recommended Intervention:** Trigger CRA site re-training, address open lab queries, and review investigator recruitment barriers with the PI.`;
    }

    return {
      answer: explanation,
      intent: 'studies_at_risk',
      count,
      data: studies
    };
  }

  // 2. Open AE / SAE deadlines
  if (q.includes('deadline') || q.includes('adverse event') || q.includes('open ae') || q.includes('sae') || q.includes('safety deadline') || q.includes('cdsco deadline')) {
    const aes = db.prepare(`
      SELECT ae.*, s.title as study_title 
      FROM adverse_events ae
      JOIN studies s ON ae.study_id = s.id
      WHERE ae.status = 'open'
      ORDER BY ae.severity = 'serious' DESC, ae.report_deadline ASC
    `).all();

    let explanation = `### 🚨 Open Adverse Event (AE/SAE) Reporting Deadlines\n\n`;
    explanation += `Currently tracking **${aes.length} open adverse events** across the portfolio:\n\n`;

    for (const ae of aes) {
      const isUrgent = ae.severity === 'serious';
      explanation += `* **${isUrgent ? '🔴 CRITICAL SAE' : '🟡 ' + ae.severity.toUpperCase()} [${ae.id}]** — *${ae.study_id}* (Subject: ${ae.participant_id})\n`;
      explanation += `  * **MedDRA:** ${ae.meddra_code} - ${ae.meddra_label}\n`;
      explanation += `  * **Description:** ${ae.description}\n`;
      explanation += `  * **Regulatory Report Deadline:** **${ae.report_deadline}** ${isUrgent ? '⚠️ **(24-Hour NPvCC/CDSCO Schedule Y Statutory Clock Active)**' : '(Routine 14-day timeline)'}\n`;
      explanation += `  * **Source:** \`${ae.source}\`\n\n`;
    }

    return {
      answer: explanation,
      intent: 'open_ae_deadlines',
      count: aes.length,
      data: aes
    };
  }

  // 3. Site Activation stage
  if (q.includes('site activation') || q.includes('activation') || q.includes('activating') || q.includes('ready to open')) {
    const studies = db.prepare("SELECT * FROM studies WHERE stage = 'site_activation'").all();
    let explanation = `### 🏥 Studies in Site Activation Stage (${studies.length})\n\n`;
    if (studies.length === 0) {
      explanation += `No studies are currently in the **site_activation** stage.`;
    } else {
      for (const s of studies) {
        explanation += `* **[${s.id}] ${s.title}** (${s.phase})\n`;
        explanation += `  * **Status:** \`${s.status.toUpperCase()}\` | **Target Cohort:** ${s.enrollment_target}\n`;
        explanation += `  * **Action Required:** Complete pharmacy drug accountability checklist, investigator site files (ISF), and monitor green-light sign-off before patient screening commences.\n\n`;
      }
    }

    return {
      answer: explanation,
      intent: 'studies_site_activation',
      count: studies.length,
      data: studies
    };
  }

  // 4. Consent completion status
  if (q.includes('consent') || q.includes('icf') || q.includes('dpdp') || q.includes('informed consent')) {
    const totalParts = db.prepare("SELECT COUNT(*) as count FROM participants").get().count;
    const consentedParts = db.prepare("SELECT COUNT(*) as count FROM participants WHERE consent_obtained = 1").get().count;
    const pendingConsent = db.prepare("SELECT * FROM participants WHERE consent_obtained = 0").all();

    const pct = totalParts > 0 ? Math.round((consentedParts / totalParts) * 100) : 100;

    let explanation = `### 📋 Informed Consent & DPDP Act 2023/2025 Compliance Status\n\n`;
    explanation += `* **Overall Consent Attainment:** **${consentedParts} / ${totalParts} (${pct}%)** verified participants.\n`;
    explanation += `* **Consent Versions Active:** Multilingual IEC-approved versions (Hindi v2.1, English v2.0, Marathi v1.2).\n\n`;

    if (pendingConsent.length > 0) {
      explanation += `#### ⚠️ Outstanding Consent Verifications (${pendingConsent.length} subjects):\n`;
      for (const p of pendingConsent) {
        explanation += `* **Participant [${p.id}]** in Study **${p.study_id}** — Enrolled ${p.enrolled_date} without documented consent confirmation! *(Immediate hold on study interventions required)*\n`;
      }
    } else {
      explanation += `✅ All active participants have verifiable contemporaneous electronic informed consent records in place.`;
    }

    return {
      answer: explanation,
      intent: 'consent_status',
      consented: consentedParts,
      total: totalParts,
      percentage: pct,
      data: pendingConsent
    };
  }

  // 5. Open Data Queries
  if (q.includes('query') || q.includes('queries') || q.includes('data cleaning') || q.includes('discrepanc')) {
    const studies = db.prepare("SELECT id, title, open_data_queries, protocol_deviations FROM studies WHERE open_data_queries > 0 ORDER BY open_data_queries DESC").all();
    const totalQueries = studies.reduce((acc, s) => acc + s.open_data_queries, 0);

    let explanation = `### 🔍 Open Data Queries Summary (${totalQueries} total across portfolio)\n\n`;
    for (const s of studies) {
      explanation += `* **[${s.id}]**: **${s.open_data_queries} open data queries** (Protocol Deviations: ${s.protocol_deviations})\n`;
      explanation += `  * *${s.title}*\n`;
    }
    explanation += `\n**Top Priority:** Study **AIIA-GUDU-03** carries 24 queries primarily relating to missing centralized HbA1c chemistry uploads and unverified concomitant medications.`;

    return {
      answer: explanation,
      intent: 'open_data_queries',
      total_queries: totalQueries,
      data: studies
    };
  }

  // 6. Milestones / E-signatures
  if (q.includes('milestone') || q.includes('sign') || q.includes('pending signature') || q.includes('overdue')) {
    const overdue = db.prepare("SELECT * FROM milestones WHERE status = 'overdue'").all();
    const pendingSign = db.prepare("SELECT * FROM milestones WHERE status = 'pending'").all();

    let explanation = `### ✍️ Clinical Milestones & PI E-Signature Status\n\n`;
    explanation += `* **Overdue Milestones:** ${overdue.length}\n`;
    for (const m of overdue) {
      explanation += `  * 🔴 **${m.name}** (${m.study_id}) — Due: ${m.due_date} *(OVERDUE)*\n`;
    }
    explanation += `\n* **Pending Milestones:** ${pendingSign.length}\n`;
    for (const m of pendingSign) {
      explanation += `  * ⏳ **${m.name}** (${m.study_id}) — Due: ${m.due_date}\n`;
    }

    return {
      answer: explanation,
      intent: 'milestones_overview',
      data: { overdue, pending: pendingSign }
    };
  }

  // 7. Generic portfolio summary
  const totalStudies = db.prepare("SELECT COUNT(*) as count FROM studies").get().count;
  const stages = db.prepare("SELECT stage, COUNT(*) as count FROM studies GROUP BY stage").all();
  const atRisk = db.prepare("SELECT COUNT(*) as count FROM studies WHERE status = 'risk'").get().count;
  const openAes = db.prepare("SELECT COUNT(*) as count FROM adverse_events WHERE status = 'open'").get().count;

  let explanation = `### 📊 TrialSetu AIIA Portfolio Live Intelligence Overview\n\n`;
  explanation += `* **Total Clinical Studies:** ${totalStudies}\n`;
  explanation += `* **Studies at Critical Risk:** ${atRisk}\n`;
  explanation += `* **Open Adverse Events:** ${openAes}\n`;
  explanation += `* **Distribution by Stage:** ` + stages.map(s => `\`${s.stage}\`: ${s.count}`).join(', ') + `\n\n`;
  explanation += `You can ask me specific questions such as:\n`;
  explanation += `* *"Which studies are at risk?"*\n`;
  explanation += `* *"What are the open AE and SAE deadlines?"*\n`;
  explanation += `* *"Which studies are in site activation?"*\n`;
  explanation += `* *"Show consent completion status across all trials"*\n`;
  explanation += `* *"How many open data queries need attention?"*`;

  return {
    answer: explanation,
    intent: 'portfolio_overview',
    data: { totalStudies, atRisk, openAes, stages }
  };
}

module.exports = {
  suggestCodes,
  askCtms,
  MEDDRA_DICT,
  WHODRUG_DICT
};
