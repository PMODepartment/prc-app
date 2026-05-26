/* db.js — Firestore data operations */
const WPDb = (() => {

  /* ── Projects ─────────────────────────────────────────────────────── */
  async function getProjects() {
    const snap = await DB.collection('projects').orderBy('id').get();
    return snap.docs.map(d => d.data());
  }

  async function getProject(id) {
    const doc = await DB.collection('projects').doc(id).get();
    return doc.exists ? doc.data() : null;
  }

  async function saveProject(data) {
    await DB.collection('projects').doc(data.id).set(data, { merge: true });
  }

  /* ── Work Packages ────────────────────────────────────────────────── */

  /* Get all approved WPs for a project (for dashboard) */
  async function getApprovedWPs(projectId) {
    const snap = await DB.collection('work_packages')
      .where('project_id', '==', projectId)
      .where('review_status', '==', 'approved')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (a.cost_code||'').localeCompare(b.cost_code||''));
  }

  /* Get all approved WPs across all projects */
  async function getAllApprovedWPs() {
    const snap = await DB.collection('work_packages')
      .where('review_status', '==', 'approved')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (a.cost_code||'').localeCompare(b.cost_code||''));
  }

  /* Get all pending WPs (for admin review) */
  async function getPendingWPs() {
    const snap = await DB.collection('work_packages')
      .where('review_status', '==', 'pending_review')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => {
        const ta = a.submitted_at?.toMillis?.() || 0;
        const tb = b.submitted_at?.toMillis?.() || 0;
        return ta - tb;
      });
  }

  /* Get WPs assigned to a specific officer */
  async function getOfficerWPs(uid) {
    const snap = await DB.collection('work_packages')
      .where('assigned_officer_uid', '==', uid)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (a.cost_code||'').localeCompare(b.cost_code||''));
  }

  /* Get a single WP */
  async function getWP(id) {
    const doc = await DB.collection('work_packages').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  /* Get all WPs for a project (admin view — all review statuses) */
  async function getProjectWPs(projectId) {
    const snap = await DB.collection('work_packages')
      .where('project_id', '==', projectId)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (a.cost_code||'').localeCompare(b.cost_code||''));
  }

  /* Submit new WP (officer) — starts as pending_review */
  async function submitWP(data, submitterProfile) {
    const ref = DB.collection('work_packages').doc();
    await ref.set({
      ...data,
      firestore_id:         ref.id,
      review_status:        'pending_review',
      submitted_by_uid:     submitterProfile.uid,
      submitted_by_name:    submitterProfile.name,
      submitted_at:         firebase.firestore.FieldValue.serverTimestamp(),
      approved_by_uid:      null,
      approved_by_name:     null,
      approved_at:          null,
      rejected_by_uid:      null,
      rejected_by_name:     null,
      rejected_at:          null,
      rejection_reason:     null,
      last_updated_at:      firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  }

  /* Update existing WP (officer edit) — back to pending_review */
  async function updateWP(firestoreId, data, submitterProfile) {
    await DB.collection('work_packages').doc(firestoreId).update({
      ...data,
      review_status:     'pending_review',
      submitted_by_uid:  submitterProfile.uid,
      submitted_by_name: submitterProfile.name,
      submitted_at:      firebase.firestore.FieldValue.serverTimestamp(),
      last_updated_at:   firebase.firestore.FieldValue.serverTimestamp(),
      approved_by_uid:   null,
      approved_by_name:  null,
      approved_at:       null,
      rejection_reason:  null,
    });
  }

  /* Approve WP (admin) */
  async function approveWP(firestoreId, adminProfile) {
    await DB.collection('work_packages').doc(firestoreId).update({
      review_status:    'approved',
      approved_by_uid:  adminProfile.uid,
      approved_by_name: adminProfile.name,
      approved_at:      firebase.firestore.FieldValue.serverTimestamp(),
      rejected_by_uid:  null,
      rejected_by_name: null,
      rejected_at:      null,
      rejection_reason: null,
      last_updated_at:  firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  /* Reject WP (admin) */
  async function rejectWP(firestoreId, adminProfile, reason) {
    await DB.collection('work_packages').doc(firestoreId).update({
      review_status:    'rejected',
      rejected_by_uid:  adminProfile.uid,
      rejected_by_name: adminProfile.name,
      rejected_at:      firebase.firestore.FieldValue.serverTimestamp(),
      rejection_reason: reason,
      last_updated_at:  firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  /* Assign officer to WP (admin) */
  async function assignOfficer(firestoreId, officerUid, officerName) {
    await DB.collection('work_packages').doc(firestoreId).update({
      assigned_officer_uid:  officerUid,
      assigned_officer_name: officerName,
      last_updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
    });
    /* Also update officer's assigned_wps list */
    const wp = await getWP(firestoreId);
    if (wp && officerUid) {
      await DB.collection('users').doc(officerUid).update({
        assigned_wps: firebase.firestore.FieldValue.arrayUnion(firestoreId),
      });
    }
  }

  /* Seed WP from JSON (one-time import) — marks as approved directly */
  async function seedWP(data) {
    const existing = await DB.collection('work_packages')
      .where('project_id', '==', data.project_id)
      .where('wp_no', '==', data.wp_no)
      .get();
    if (!existing.empty) return; // skip if already exists
    const ref = DB.collection('work_packages').doc();
    await ref.set({
      ...data,
      firestore_id:         ref.id,
      review_status:        'approved',
      submitted_by_uid:     'seed',
      submitted_by_name:    'Data Import',
      submitted_at:         firebase.firestore.FieldValue.serverTimestamp(),
      approved_by_uid:      'seed',
      approved_by_name:     'Data Import',
      approved_at:          firebase.firestore.FieldValue.serverTimestamp(),
      rejected_by_uid:      null,
      rejected_by_name:     null,
      rejected_at:          null,
      rejection_reason:     null,
      assigned_officer_uid:  null,
      assigned_officer_name: null,
      last_updated_at:      firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  return {
    getProjects, getProject, saveProject,
    getApprovedWPs, getAllApprovedWPs, getPendingWPs,
    getOfficerWPs, getWP, getProjectWPs,
    submitWP, updateWP, approveWP, rejectWP,
    assignOfficer, seedWP,
  };
})();

/* ── Computed fields ──────────────────────────────────────────────────── */
const Calc = {
  awardingLeadTime(wp) {
    if (!wp.actual_awarding_date || !wp.awarding_date) return null;
    return Math.round((new Date(wp.actual_awarding_date) - new Date(wp.awarding_date)) / 86400000);
  },
  deliveryLeadTime(wp) {
    if (!wp.target_delivery_date || !wp.actual_awarding_date) return null;
    return Math.round((new Date(wp.target_delivery_date) - new Date(wp.actual_awarding_date)) / 86400000);
  },
  variance(wp) {
    if (wp.approved_budget_php == null || wp.contract_amount_php == null) return null;
    return wp.approved_budget_php - wp.contract_amount_php;
  },
  variancePct(wp) {
    const v = Calc.variance(wp);
    if (v == null || !wp.approved_budget_php) return null;
    return (v / wp.approved_budget_php) * 100;
  },
};

/* ── Formatters ───────────────────────────────────────────────────────── */
const Fmt = {
  date(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'2-digit' });
  },
  money(v, dec=2) {
    if (v == null) return '—';
    return '₱' + (v/1e6).toFixed(dec) + 'M';
  },
  badgeHtml(status) {
    const map = { 'Awarded':'badge-awarded', 'Partially Awarded':'badge-partial', 'Not Yet Awarded':'badge-notyet' };
    return `<span class="badge ${map[status]||'badge-notyet'}">${status}</span>`;
  },
  reviewBadge(rs) {
    const map = { approved:'badge-awarded', pending_review:'badge-partial', rejected:'badge-notyet' };
    const lbl = { approved:'Approved', pending_review:'Pending Review', rejected:'Rejected' };
    return `<span class="badge ${map[rs]||'badge-notyet'}">${lbl[rs]||rs}</span>`;
  },
  leadTimeHtml(v) {
    if (v==null) return '<span class="lt-na">—</span>';
    if (v>0)  return `<span class="lt-late">+${v}d late</span>`;
    if (v<0)  return `<span class="lt-early">${Math.abs(v)}d early</span>`;
    return `<span class="lt-early">On time</span>`;
  },
  deliveryHtml(v) {
    if (v==null) return '<span class="lt-na">—</span>';
    if (v<0)  return `<span class="lt-late">${Math.abs(v)}d overdue</span>`;
    return `<span class="lt-early">${v}d remaining</span>`;
  },
  varianceHtml(v) {
    if (v==null) return '<span class="lt-na">—</span>';
    const m=(Math.abs(v)/1e6).toFixed(2);
    if (v>0) return `<span class="lt-early">+₱${m}M</span>`;
    if (v<0) return `<span class="lt-late">-₱${m}M</span>`;
    return '<span>₱0M</span>';
  },
  variancePctHtml(v) {
    if (v==null) return '<span class="lt-na">—</span>';
    if (v>0) return `<span class="lt-early">+${v.toFixed(1)}%</span>`;
    if (v<0) return `<span class="lt-late">${v.toFixed(1)}%</span>`;
    return '<span>0%</span>';
  },
};

/* ── Stats ────────────────────────────────────────────────────────────── */
function computeStats(wps) {
  const awarded  = wps.filter(w => w.status === 'Awarded');
  const partial  = wps.filter(w => w.status === 'Partially Awarded');
  const notYet   = wps.filter(w => w.status === 'Not Yet Awarded');
  const hasCon   = wps.filter(w => w.contract_amount_php != null);
  const totalBudget   = wps.reduce((s,w)=>s+(w.approved_budget_php||0),0);
  const totalContract = hasCon.reduce((s,w)=>s+w.contract_amount_php,0);
  const netVariance   = hasCon.reduce((s,w)=>s+(Calc.variance(w)||0),0);
  const lateAwards    = wps.filter(w=>(Calc.awardingLeadTime(w)||0)>0).length;
  const awardRate     = wps.length ? Math.round(awarded.length/wps.length*100) : 0;
  return { awarded, partial, notYet, hasCon, totalBudget, totalContract, netVariance, lateAwards, awardRate, total:wps.length };
}

/* ── CSV Export ───────────────────────────────────────────────────────── */
function exportCSV(wps, label) {
  const headers = ['Cost Code','WP No.','Description','Zone','Trade',
    'Lead Time (Days)','Awarding Date','Actual Awarding Date','Awarding Lead Time (Days)',
    'Target Delivery','Delivery Lead Time (Days)',"Target Inst'n","Target Comp'n",
    'Approved Budget (PHP)','Contract Amount (PHP)','Variance (PHP)','Variance (%)','Status','Contractor','Remarks','Review Status','Assigned Officer'];
  const rows = wps.map(w => {
    const v=Calc.variance(w), vp=Calc.variancePct(w);
    return [w.cost_code,w.wp_no,`"${w.description}"`,w.zone,w.trade,
      w.lead_time_days??'',w.awarding_date??'',w.actual_awarding_date??'',
      Calc.awardingLeadTime(w)??'',w.target_delivery_date??'',
      Calc.deliveryLeadTime(w)??'',w.target_installation_date??'',w.target_completion_date??'',
      w.approved_budget_php??'',w.contract_amount_php??'',
      v??'',vp!=null?vp.toFixed(2):'',
      w.status,w.contractor??'',w.remarks??'',
      w.review_status??'',w.assigned_officer_name??''].join(',');
  });
  const csv=[headers.join(','),...rows].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=`WPM_${label}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
