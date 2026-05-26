/* data.js — load project JSON + computed fields + formatters */

const DataStore = (() => {
  const cache = {};
  async function loadProjects() {
    if (cache.projects) return cache.projects;
    const res = await fetch('data/projects.json');
    cache.projects = await res.json();
    return cache.projects;
  }
  async function loadWorkPackages(projectId) {
    if (cache[projectId]) return cache[projectId];
    const projects = await loadProjects();
    const proj = projects.find(p => p.id === projectId);
    const res = await fetch(proj.data_file);
    cache[projectId] = await res.json();
    return cache[projectId];
  }
  async function loadAll() {
    const projects = await loadProjects();
    const packages = await Promise.all(projects.map(p => loadWorkPackages(p.id)));
    return { projects, packages };
  }
  return { loadProjects, loadWorkPackages, loadAll };
})();

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

const Fmt = {
  date(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' });
  },
  money(v, dec = 2) {
    if (v == null) return '—';
    return '₱' + (v / 1e6).toFixed(dec) + 'M';
  },
  badgeHtml(status) {
    const map = { 'Awarded': 'badge-awarded', 'Partially Awarded': 'badge-partial', 'Not Yet Awarded': 'badge-notyet' };
    return `<span class="badge ${map[status] || 'badge-notyet'}">${status}</span>`;
  },
  leadTimeHtml(v) {
    if (v == null) return '<span class="lt-na">—</span>';
    if (v > 0) return `<span class="lt-late">+${v}d late</span>`;
    if (v < 0) return `<span class="lt-early">${Math.abs(v)}d early</span>`;
    return `<span class="lt-early">On time</span>`;
  },
  deliveryHtml(v) {
    if (v == null) return '<span class="lt-na">—</span>';
    if (v < 0) return `<span class="lt-late">${Math.abs(v)}d overdue</span>`;
    return `<span class="lt-early">${v}d remaining</span>`;
  },
  varianceHtml(v) {
    if (v == null) return '<span class="lt-na">—</span>';
    const m = (Math.abs(v) / 1e6).toFixed(2);
    if (v > 0) return `<span class="lt-early">+₱${m}M</span>`;
    if (v < 0) return `<span class="lt-late">-₱${m}M</span>`;
    return '<span>₱0M</span>';
  },
  variancePctHtml(v) {
    if (v == null) return '<span class="lt-na">—</span>';
    if (v > 0) return `<span class="lt-early">+${v.toFixed(1)}%</span>`;
    if (v < 0) return `<span class="lt-late">${v.toFixed(1)}%</span>`;
    return '<span>0%</span>';
  },
};

function computeStats(wps) {
  const awarded  = wps.filter(w => w.status === 'Awarded');
  const partial  = wps.filter(w => w.status === 'Partially Awarded');
  const notYet   = wps.filter(w => w.status === 'Not Yet Awarded');
  const hasCon   = wps.filter(w => w.contract_amount_php != null);
  const totalBudget   = wps.reduce((s, w) => s + (w.approved_budget_php || 0), 0);
  const totalContract = hasCon.reduce((s, w) => s + w.contract_amount_php, 0);
  const netVariance   = hasCon.reduce((s, w) => s + (Calc.variance(w) || 0), 0);
  const lateAwards    = wps.filter(w => (Calc.awardingLeadTime(w) || 0) > 0).length;
  const awardRate     = wps.length ? Math.round(awarded.length / wps.length * 100) : 0;
  return { awarded, partial, notYet, hasCon, totalBudget, totalContract, netVariance, lateAwards, awardRate, total: wps.length };
}

function exportCSV(wps, projectId) {
  const headers = ['Cost Code No.','WP No.','Work Package Description','Zone','Trade',
    'Lead Time (Days)','Awarding Date','Actual Awarding Date','Awarding Lead Time (Days)',
    'Target Delivery Date','Delivery Lead Time (Days)',"Target Inst'n Date","Target Comp'n Date",
    'Approved Budget (PHP)','Contract Amount (PHP)','Variance (PHP)','Variance (%)','Status','Contractor','Remarks'];
  const rows = wps.map(w => {
    const v  = Calc.variance(w);
    const vp = Calc.variancePct(w);
    return [w.cost_code, w.wp_no, `"${w.description}"`, w.zone, w.trade,
      w.lead_time_days ?? '', w.awarding_date ?? '', w.actual_awarding_date ?? '',
      Calc.awardingLeadTime(w) ?? '', w.target_delivery_date ?? '',
      Calc.deliveryLeadTime(w) ?? '', w.target_installation_date ?? '', w.target_completion_date ?? '',
      w.approved_budget_php ?? '', w.contract_amount_php ?? '',
      v ?? '', vp != null ? vp.toFixed(2) : '',
      w.status, w.contractor ?? '', w.remarks ?? ''].join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `WPM_${projectId}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
