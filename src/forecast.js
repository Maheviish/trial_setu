// src/forecast.js - Predictive Completion Forecasting Engine
// Computes live velocity, projected completion dates, and delay risks based on actual enrollment pace.

function computeForecast(study) {
  const now = new Date('2026-03-28T00:00:00Z'); // Current demo time reference
  const startDate = new Date(study.start_date);
  
  const elapsedMs = Math.max(now.getTime() - startDate.getTime(), 1000 * 60 * 60 * 24);
  const elapsedDays = Math.max(Math.round(elapsedMs / (1000 * 60 * 60 * 24)), 1);

  const enrolled = Number(study.enrolled) || 0;
  const target = Number(study.enrollment_target) || 1;
  const remaining = Math.max(target - enrolled, 0);

  // Velocity in participants per day
  const dailyVelocity = enrolled > 0 ? enrolled / elapsedDays : 0;
  const monthlyVelocity = dailyVelocity * 30.4375;

  // Planned target pace (assume nominal 12-month standard recruitment window)
  const plannedDurationDays = 365;
  const plannedVelocity = target / plannedDurationDays;

  let projectedDaysNeeded = null;
  let projectedCompletionDate = null;
  let paceStatus = 'on_track';
  let delayDays = 0;
  let narrative = '';

  if (enrolled >= target) {
    paceStatus = 'completed';
    narrative = 'Enrollment target achieved (100%). Study proceeding in protocol follow-up.';
  } else if (dailyVelocity === 0) {
    if (study.stage === 'site_activation' || study.stage === 'protocol_iec' || study.stage === 'ctri_registration') {
      paceStatus = 'pending_activation';
      narrative = `Study in ${study.stage.replace('_', ' ').toUpperCase()} stage. Enrollment has not yet opened.`;
    } else {
      paceStatus = 'critical_risk';
      narrative = 'No participants enrolled despite active recruitment window. Immediate protocol rescue needed.';
    }
  } else {
    projectedDaysNeeded = Math.ceil(remaining / dailyVelocity);
    const projDate = new Date(now.getTime() + (projectedDaysNeeded * 24 * 60 * 60 * 1000));
    projectedCompletionDate = projDate.toISOString().split('T')[0];

    // Compare with planned completion
    const plannedEndDate = new Date(startDate.getTime() + (plannedDurationDays * 24 * 60 * 60 * 1000));
    const plannedRemainingDays = Math.max(Math.round((plannedEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)), 0);
    delayDays = projectedDaysNeeded - plannedRemainingDays;

    if (delayDays > 60 || dailyVelocity < (plannedVelocity * 0.6)) {
      paceStatus = 'critical_risk';
      narrative = `Enrollment lagging significantly. At current pace (${dailyVelocity.toFixed(2)} pts/day), completion projected for ${projectedCompletionDate} (~${delayDays} days behind target).`;
    } else if (delayDays > 15 || dailyVelocity < (plannedVelocity * 0.9)) {
      paceStatus = 'watch';
      narrative = `Moderate delay detected. Current pace ${dailyVelocity.toFixed(2)} pts/day vs required ${plannedVelocity.toFixed(2)}. Projected completion: ${projectedCompletionDate}.`;
    } else {
      paceStatus = 'on_track';
      narrative = `Recruitment pace optimal (${dailyVelocity.toFixed(2)} pts/day). Projected completion on ${projectedCompletionDate} within target window.`;
    }
  }

  const completionPct = Math.min(Math.round((enrolled / target) * 100), 100);

  return {
    study_id: study.id,
    enrolled,
    enrollment_target: target,
    remaining_participants: remaining,
    completion_percentage: completionPct,
    elapsed_days: elapsedDays,
    daily_velocity: Number(dailyVelocity.toFixed(3)),
    monthly_velocity: Number(monthlyVelocity.toFixed(1)),
    planned_velocity: Number(plannedVelocity.toFixed(3)),
    projected_days_needed: projectedDaysNeeded,
    projected_completion_date: projectedCompletionDate,
    projected_delay_days: delayDays > 0 ? delayDays : 0,
    pace_status: paceStatus,
    narrative
  };
}

module.exports = {
  computeForecast
};
