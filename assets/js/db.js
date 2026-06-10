
/* â”€â”€ WPDb â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const WPDb = (() => {
  function mapWP(w) {
    if (!w) return null;
    return {
      ...w,
      firestoreId: w.id,
      approved_budget_bcb: w.approved_budget_bcb ?? null,
      budget_bcb: w.approved_budget_bcb ?? null,
      total_awarded: w.total_awarded ?? 0,
      contract_amount_php: w.total_awarded ?? 0,
      award_status: w.award_status || 'Not Yet Awarded',
    };
  }
  function unmap(w) {
    const d = { ...w };
    if (d.budget_bcb && !d.approved_budget_bcb) d.approved_budget_bcb = d.budget_bcb;
    delete d.firestoreId; delete d.budget_bcb; delete d.contract_amount_php; delete d.id;
    delete d.total_awarded; delete d.variance; delete d.awarding_lead_time;
    return d;
  }
  async function getProjects() { const sb=await getSB(); const {data}=await sb.from('projects').select('*').order('id'); return data||[]; }
  async function getProject(id) { const sb=await getSB(); const {data}=await sb.from('projects').select('*').eq('id',id).single(); return data; }
  async function saveProject(d) { const sb=await getSB(); const {data}=await sb.from('projects').upsert(d,{onConflict:'id'}).select().single(); return data; }
  async function getApprovedWPs(pid) { const sb=await getSB(); let q=sb.from('work_packages').select('*').eq('review_status','approved'); if(pid) q=q.eq('project_id',pid); const {data}=await q.order('wp_no'); return (data||[]).map(mapWP); }
  async function getAllWPs(pid) { const sb=await getSB(); let q=sb.from('work_packages').select('*'); if(pid) q=q.eq('project_id',pid); const {data}=await q.order('wp_no'); return (data||[]).map(mapWP); }
  async function getAllApprovedWPs() { return getApprovedWPs(null); }
  async function getApprovedWPsForProjects(ids) { if(!ids||!ids.length) return []; const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').eq('review_status','approved').in('project_id',ids).order('wp_no'); return (data||[]).map(mapWP); }
  async function getPendingWPs() { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').eq('review_status','pending_review').order('created_at',{ascending:false}); return (data||[]).map(mapWP); }
  async function getAllWPsForAdmin() { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').order('created_at',{ascending:false}); return (data||[]).map(mapWP); }
  async function getAllWPsForProjects(ids) { if(!ids||!ids.length) return []; const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').in('project_id',ids).order('created_at',{ascending:false}); return (data||[]).map(mapWP); }
  async function getOfficerWPs(uid) { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').eq('assigned_officer',uid).order('wp_no'); return (data||[]).map(mapWP); }
  async function getWP(id) { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').eq('id',id).single(); return mapWP(data); }
  async function getProjectWPs(pid) { return getAllWPs(pid); }
  async function submitWP(d,p) { const sb=await getSB(); const {data,error}=await sb.from('work_packages').insert({...unmap(d),review_status:'pending_review',assigned_officer:p?.id||null}).select().single(); if(error) throw error; return data; }
  async function updateWP(id,d) { const sb=await getSB(); const {data,error}=await sb.from('work_packages').update({...unmap(d),review_status:'pending_review'}).eq('id',id).select().single(); if(error) throw error; return data; }
  async function updateWPDirect(id,d) { const sb=await getSB(); const {data,error}=await sb.from('work_packages').update(unmap(d)).eq('id',id).select().single(); if(error) throw error; return data; }
  async function saveProject(d) { const sb=await getSB(); const {data}=await sb.from('projects').upsert(d,{onConflict:'id'}).select().single(); return data; }
  async function createProject(d) { const sb=await getSB(); const {data,error}=await sb.from('projects').insert(d).select().single(); if(error) throw error; return data; }
  async function approveWP(id) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({review_status:'approved'}).eq('id',id).select().single(); return data; }
  async function rejectWP(id,_,reason) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({review_status:'rejected',review_notes:reason}).eq('id',id).select().single(); return data; }
  async function assignOfficer(id,uid) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({assigned_officer:uid}).eq('id',id).select().single(); return data; }
  async function getAllUsers() { const sb=await getSB(); const {data}=await sb.from('users').select('*').order('created_at',{ascending:false}); return data||[]; }
  async function getUsersForAdmin(profile) {
    const all = await getAllUsers();
    if (profile.role === 'super_admin') return all;
    // admin: see users explicitly assigned to them, plus unassigned pending users
    return all.filter(u =>
      u.assigned_admin === profile.id ||
      (u.assigned_admin == null && u.status === 'pending')
    );
  }
  async function getAdminUsers() { const sb=await getSB(); const {data}=await sb.from('users').select('id,name,email,role').in('role',['admin','super_admin']).eq('status','approved').order('name'); return data||[]; }
  async function getManagerUsers() { const sb=await getSB(); const {data}=await sb.from('users').select('id,name,email,role').eq('role','manager').eq('status','approved').order('name'); return data||[]; }
  async function updateUser(id, updates) {
    const sb = await getSB();
    // Strip assigned_admin if it's in the payload but the column may not exist yet —
    // attempt the full update; if Supabase returns "column does not exist" retry without it
    const {data, error} = await sb.from('users').update(updates).eq('id',id).select().single();
    if (error) {
      if ((error.message||'').includes('assigned_admin') || error.code === '42703') {
        const safe = {...updates}; delete safe.assigned_admin;
        const {data:d2, error:e2} = await sb.from('users').update(safe).eq('id',id).select().single();
        if (e2) throw new Error(e2.message);
        return d2;
      }
      throw new Error(error.message);
    }
    return data;
  }
  async function updateLastLogin(id) {
    try {
      const sb = await getSB();
      await sb.from('users').update({last_login: new Date().toISOString()}).eq('id',id);
    } catch(e) { /* non-critical — ignore */ }
  }
  async function archiveProject(id) { const sb=await getSB(); const {error}=await sb.from('projects').update({status:'archived'}).eq('id',id); if(error) throw error; }
  async function unarchiveProject(id) { const sb=await getSB(); const {error}=await sb.from('projects').update({status:'active'}).eq('id',id); if(error) throw error; }
  async function updateProject(id,data) { const sb=await getSB(); const {data:d,error}=await sb.from('projects').update(data).eq('id',id).select().single(); if(error) throw error; return d; }
  async function deleteProject(id) { const sb=await getSB(); await sb.from('work_packages').delete().eq('project_id',id); const {error}=await sb.from('projects').delete().eq('id',id); if(error) throw error; }
  async function seedWP(d) { return submitWP(d,null); }
  return { getProjects,getProject,saveProject,createProject,getApprovedWPs,getAllWPs,getAllApprovedWPs,getApprovedWPsForProjects,getPendingWPs,getAllWPsForAdmin,getAllWPsForProjects,getOfficerWPs,getWP,getProjectWPs,submitWP,updateWP,updateWPDirect,approveWP,rejectWP,assignOfficer,getAllUsers,getUsersForAdmin,getAdminUsers,getManagerUsers,updateUser,updateLastLogin,archiveProject,unarchiveProject,updateProject,deleteProject,seedWP };
})();

/* â”€â”€ Stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function computeStats(wps) {
  const total=wps.length;
  const awarded=wps.filter(w=>w.award_status==='Awarded').length;
  const partial=wps.filter(w=>w.award_status==='Partially Awarded').length;
  const notAwarded=wps.filter(w=>!['Awarded','Partially Awarded'].includes(w.award_status)).length;
  const totalBudget=wps.reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
  const totalContract=wps.reduce((s,w)=>s+(w.total_awarded||0),0);
  const variance=totalBudget-totalContract;
  const today=new Date();
  const late=wps.filter(w=>w.award_status!=='Awarded'&&w.awarding_date&&new Date(w.awarding_date)<today).length;
  return {total,awarded,partial,notAwarded,totalBudget,totalContract,variance,late,awardRate:total?Math.round(awarded/total*100):0};
}

/* â”€â”€ Formatting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const Fmt = {
  money(v, decimals=2) {
    if (v==null||isNaN(v)) return '\u2014';
    return '\u20B1'+(Math.abs(v)/1e6).toFixed(decimals)+'M';
  },
  moneyFull(v) {
    if (v==null||isNaN(v)) return '\u2014';
    return '\u20B1'+Math.round(Math.abs(v)).toLocaleString('en-US');
  },
  date(d) {
    if (!d) return '\u2014';
    try { return new Date(d).toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}); }
    catch { return d; }
  }
};

const Calc = {
  variance(w) { return (w.approved_budget_bcb??0)-(w.total_awarded??0); }
};

/* â”€â”€ CSV Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function exportCSV(wps, label) {
  // Sort by project then WP number for clean consolidated output
  const sorted = [...wps].sort((a,b) => {
    const pCmp = (a.project_id||'').localeCompare(b.project_id||'');
    if (pCmp !== 0) return pCmp;
    // Natural sort WP numbers (WP-1 < WP-10 < WP-100)
    const na = parseInt((a.wp_no||'').replace(/\D/g,''))||0;
    const nb = parseInt((b.wp_no||'').replace(/\D/g,''))||0;
    return na - nb;
  });

  const h = [
    // Identity
    'Project','WP No','Cost Code','Trade','Works','Type of Works','Zone',
    // Description
    'Work Package Description','Scope of Work','Type of Service',
    'Type of Procurement','Type of Contract',
    // Charging
    'Charging Type','Contract Package No.','CO Description',
    // Vendors & PO
    'Proposed Vendors','No. of PO/JO','PO/JO Numbers',
    // Team
    'Responsible Team','Approver','Support Team',
    // Procurement schedule
    'Lead Time (d)','Planned Award Date','Actual Award Date',
    'Target Delivery','Actual Delivery','Target Installation','Target Completion',
    // Budget & contract
    'Budget BCB (PHP)','Contract Amount (PHP)','Total Awarded (PHP)','Variance (PHP)',
    'Award Status','Contractor',
    // Bonds
    'Surety Bond','Performance Bond','Warranty Bond',
    // Payment terms
    'Payment Terms (d)','DP %','DP Terms','DP Amount (PHP)','DP Release Date','DP Notes',
    // Retention
    'Retention %','Retention Amount (PHP)','Retention Period',
    // Submittals
    'Requires Submittal Approval','Type of Submittal','Submittal Approver','Approval Date',
    // Status
    'Procurement Status','Awarding Status','Delivery Status','Submittal Status',
    'Purchase Request','Remarks',
  ];

  const pct = v => v != null ? (parseFloat(v) * 100).toFixed(2) + '%' : '';
  const cell = v => `"${(v??'').toString().replace(/"/g,'""')}"`;
  const rows = sorted.map(w => [
    // Identity
    w.project_id, w.wp_no, w.cost_code, w.trade, w.works, w.type_of_works, w.zone,
    // Description
    w.description, w.scope, w.type_of_service,
    w.type_of_procurement, w.type_of_contract,
    // Charging
    w.charging_type, w.contract_package_no, w.co_description,
    // Vendors & PO
    w.proposed_vendors, w.po_jo_count, w.po_jo_numbers,
    // Team
    w.responsible_team, w.approver, w.support_team,
    // Procurement schedule
    w.awarding_lead_time, w.awarding_date, w.actual_awarding_date,
    w.target_delivery, w.actual_delivery, w.target_installation, w.target_completion,
    // Budget & contract
    w.approved_budget_bcb, w.awarded_cost, w.total_awarded, w.variance,
    w.award_status, w.contractor,
    // Bonds
    w.surety_bond, w.performance_bond, w.warranty_bond,
    // Payment terms
    w.payment_terms_days, pct(w.dp_percent), w.dp_terms, w.dp_amount, w.dp_release_date, w.dp_notes,
    // Retention
    pct(w.retention_percent), w.retention_amount, w.retention_period,
    // Submittals
    w.requires_approval ? 'Yes' : 'No', w.submittal_document_type, w.approver_name, w.approval_date,
    // Status
    w.procurement_status, w.awarding_status, w.delivery_status, w.submittal_type,
    w.purchase_request, w.remarks,
  ].map(cell).join(','));

  // BOM + header + data â€” BOM ensures Excel opens UTF-8 correctly (handles â‚± etc)
  const BOM = '\uFEFF';
  const csv = BOM + [h.join(','), ...rows].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${label||'wps'}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* â”€â”€ User bar â€” avatar only, role in dropdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderUserBar(id, profile) {
  const el = document.getElementById(id);
  if (!el || !profile) return;
  const initials = (profile.name||profile.email||'U').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  el.innerHTML = `
    <div style="position:relative">
      <button id="avatar-btn" onclick="toggleUserMenu()" title="${profile.name||profile.email}" style="
        width:36px;height:36px;border-radius:50%;background:#EE3124;color:#fff;
        border:none;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;
        display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</button>
      <div id="user-menu" style="
        display:none;position:absolute;right:0;top:44px;
        background:#fff;border:1px solid #f0f0f0;border-radius:12px;
        box-shadow:0 8px 32px rgba(0,0,0,.12);width:220px;z-index:9999;overflow:hidden;">
        <div style="padding:14px 16px;border-bottom:1px solid #f5f5f5;">
          <div style="font-size:13px;font-weight:600;color:#231F20">${profile.name||profile.email}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;text-transform:capitalize">${(profile.role||'').replace(/_/g,' ')}</div>
        </div>
        <a href="login.html" onclick="event.preventDefault();AppAuth.logout()" style="
          display:flex;align-items:center;gap:8px;padding:12px 16px;
          font-size:13px;color:#EE3124;font-weight:600;text-decoration:none;
          font-family:inherit;cursor:pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>Sign out
        </a>
      </div>
    </div>`;
}
window.toggleUserMenu = function() {
  const m = document.getElementById('user-menu');
  if (m) m.style.display = m.style.display==='none' ? 'block' : 'none';
};
document.addEventListener('click', function(e) {
  const btn = document.getElementById('avatar-btn');
  const menu = document.getElementById('user-menu');
  if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target))
    menu.style.display = 'none';
});

/* â”€â”€ Metrics & Rank helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function buildMetrics(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(c=>`
    <div class="metric-card ${c.accent?'metric-accent-'+c.accent:''}">
      <div class="metric-label">${c.lbl}</div>
      <div class="metric-value ${c.cls||''}">${c.val}</div>
      ${c.sub?`<div class="metric-sub">${c.sub}</div>`:''}
    </div>`).join('');
}

function buildRankTable(id, items, type) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) { el.innerHTML='<div style="color:#aaa;font-size:12px;padding:10px 0">No data</div>'; return; }

  // Inject hover-animation styles once per page
  if (!document.getElementById('_rankTblStyle')) {
    const s = document.createElement('style');
    s.id = '_rankTblStyle';
    s.textContent = [
      '.rank-row{cursor:default}',
      '.rank-row .rank-side{transition:opacity .18s ease,transform .18s ease}',
      '.rank-row:hover .rank-side{opacity:0;transform:translateX(10px)}',
      '.rank-row .rank-short,.rank-row .rank-sub{transition:opacity .15s ease}',
      '.rank-row:hover .rank-short,.rank-row:hover .rank-sub{opacity:0}',
      '.rank-full{position:absolute;left:20px;right:0;top:50%;transform:translateY(-50%) translateX(-8px);opacity:0;',
      'transition:opacity .2s ease,transform .2s ease;background:#EE3124;color:#fff;',
      'padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;',
      'pointer-events:none;z-index:5;white-space:normal;line-height:1.35;',
      'box-shadow:0 3px 10px rgba(238,49,36,.25)}',
      '.rank-row:hover .rank-full{opacity:1;transform:translateY(-50%) translateX(0)}',
    ].join('');
    document.head.appendChild(s);
  }

  const isValue  = type === 'value';
  const accent   = type === 'savings' ? '#2D9B6F' : '#EE3124';
  const valLabel = type === 'savings' ? 'Savings' : type === 'loss' ? 'Overbudget' : 'Contract Value';
  const valSign  = type === 'savings' ? '+' : type === 'loss' ? '-' : '';
  const th = (txt, right, color) =>
    `<th style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${color||'#ccc'};padding:7px ${right?'0':'8px'} 7px ${right?'8px':'0'};text-align:${right?'right':'left'};border-bottom:2px solid #f0f0f0;white-space:nowrap">${txt}</th>`;
  const thead = isValue
    ? `<tr>${th('#&nbsp;&nbsp;Work Package',false)} ${th(valLabel,true)}</tr>`
    : `<tr>${th('#&nbsp;&nbsp;Work Package',false)} ${th('BCB',true)} ${th('Awd',true)} ${th(valLabel,true,accent)} ${th('%',true,accent)}</tr>`;
  const rows = items.map((item, i) => {
    const wpCell = `<td style="padding:9px 8px 9px 0;vertical-align:middle;max-width:1px;width:99%;overflow:visible">
      <div style="display:flex;align-items:center;gap:6px;position:relative">
        <span style="font-size:10px;color:#ccc;font-weight:700;flex-shrink:0;min-width:14px">${i+1}</span>
        <div style="min-width:0;overflow:hidden;flex:1">
          <div class="rank-short" style="font-size:11px;font-weight:600;color:#231F20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.name}</div>
          <div class="rank-sub" style="font-size:9px;color:#bbb;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.sub||''}</div>
        </div>
        <div class="rank-full">${item.name}</div>
      </div>
    </td>`;
    if (isValue) {
      return `<tr class="rank-row" style="border-bottom:1px solid #f5f5f5">${wpCell}
        <td class="rank-side" style="font-size:12px;font-weight:700;color:#231F20;padding:9px 0 9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.val)}</td>
      </tr>`;
    }
    return `<tr class="rank-row" style="border-bottom:1px solid #f5f5f5">${wpCell}
      <td class="rank-side" style="font-size:10px;color:#ccc;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.bcb)}</td>
      <td class="rank-side" style="font-size:10px;color:#aaa;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.awarded)}</td>
      <td class="rank-side" style="font-size:12px;font-weight:700;color:${accent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${valSign}${Fmt.money(item.val)}</td>
      <td class="rank-side" style="font-size:11px;font-weight:600;color:${accent};padding:9px 0 9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${item.pct}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="width:100%;min-width:340px;border-collapse:collapse;font-family:inherit"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>`;
}

function buildRankList(id, items, colorClass, fmtVal) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) { el.innerHTML='<div style="color:#aaa;font-size:12px;padding:8px 0">No data</div>'; return; }
  el.innerHTML = items.map((item,i) => {
    const hasBcbAwd = item.bcb!=null && item.awarded!=null;
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #f5f5f5">
      <span style="font-size:11px;color:#aaa;font-weight:600;width:16px;flex-shrink:0;padding-top:2px">${i+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:#231F20;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${item.name}</div>
        <div style="font-size:10px;color:#999;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.sub}</div>
        ${hasBcbAwd?`<div style="font-size:10px;color:#bbb;margin-top:1px;white-space:nowrap">BCB ${Fmt.money(item.bcb)} <span style="color:#ddd">→</span> Awd ${Fmt.money(item.awarded)}</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0;padding-top:2px">
        <div style="font-size:13px;font-weight:700;color:${item.color};white-space:nowrap">${fmtVal(item.val)}</div>
        ${item.pct!=null?`<div style="font-size:10px;font-weight:600;color:${item.color};white-space:nowrap">${item.pct}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

/* ── PDF Export (jsPDF + AutoTable, lazy-loaded) ──────────────────────── */
async function _loadPDFLibs() {
  if (window.jspdf) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function exportPDF(wps, label, titleStr) {
  await _loadPDFLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pgW = doc.internal.pageSize.getWidth();
  const pgH = doc.internal.pageSize.getHeight();
  const mg  = 14;
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
  const multiProject = new Set((wps||[]).map(w=>w.project_id).filter(Boolean)).size > 1;

  // ── Computed stats ──
  const awarded    = wps.filter(w=>w.award_status==='Awarded').length;
  const totalBCB   = wps.reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
  const totalAwd   = wps.reduce((s,w)=>s+(w.total_awarded||0),0);
  const variance   = totalBCB - totalAwd;
  const awardRate  = wps.length ? Math.round(awarded/wps.length*100) : 0;
  const fmtM = v => v != null ? (v>=0?'+':'-')+((Math.abs(v))/1e6).toFixed(2)+'M' : '-';
  const fmtV = v => v != null ? ((v)/1e6).toFixed(2)+'M' : '-';
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-PH',{year:'2-digit',month:'short',day:'numeric'}) : '-';

  // ── Page header (drawn before table content via willDrawPage) ──
  const drawHeader = (pgNum) => {
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(35,31,32);
    doc.text('MEGAWIDE CONSTRUCTION CORPORATION', mg, 14);
    doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(110,110,110);
    doc.text('EPC Procurement · Work Package Management System', mg, 20);
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(35,31,32);
    doc.text(`Work Package Summary${titleStr ? ' — '+titleStr : ''}`, mg, 27);
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(130);
    doc.text(`Generated: ${dateStr}   |   Total WPs: ${wps.length}   |   Awarded: ${awarded} (${awardRate}%)   |   BCB: ${fmtV(totalBCB)}   |   Variance: ${fmtM(variance)}`, mg, 33);
    doc.setDrawColor(238,49,36); doc.setLineWidth(0.6);
    doc.line(mg, 36, pgW - mg, 36);
    if (pgNum === 1) {
      doc.setFontSize(7); doc.setFont('helvetica','italic'); doc.setTextColor(160);
      doc.text('All monetary values in PHP Millions (M). Variance = BCB - Awarded (positive = under budget).', mg, 39);
    }
  };

  // ── Footer: page number on all pages; signatures only on last page ──
  const sigH = 30;
  const drawPageNum = (pageNum, totalPages) => {
    const fy = pgH - sigH;
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(160);
    doc.text(`Page ${pageNum} of ${totalPages}`, pgW - mg, fy + 5.5, { align:'right' });
  };
  const drawSignatures = () => {
    const fy = pgH - sigH;
    doc.setDrawColor(210,210,210); doc.setLineWidth(0.3);
    doc.line(mg, fy, pgW - mg, fy);
    const bW = (pgW - mg*2 - 16) / 3;
    ['Prepared by','Confirmed by','Approved by'].forEach((lbl, i) => {
      const bx = mg + i * (bW + 8);
      doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(80);
      doc.text(lbl+':', bx, fy + 5.5);
      doc.setDrawColor(160); doc.setLineWidth(0.4);
      doc.line(bx, fy + 15, bx + bW - 4, fy + 15);
      doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(140);
      doc.text('Name & Signature over Printed Name', bx, fy + 19);
      doc.text('Date: _________________________', bx, fy + 24.5);
    });
  };

  // ── Table data ──
  const sorted = [...wps].sort((a,b) => {
    const pc = (a.project_id||'').localeCompare(b.project_id||'');
    if (pc!==0) return pc;
    return (parseInt((a.wp_no||'').replace(/\D/g,''))||0) - (parseInt((b.wp_no||'').replace(/\D/g,''))||0);
  });

  const baseCols = [
    ...(multiProject ? [{ header:'Project', dataKey:'project_id' }] : []),
    { header:'WP No.', dataKey:'wp_no' },
    { header:'Trade', dataKey:'trade' },
    { header:'Works', dataKey:'works' },
    { header:'Description', dataKey:'description' },
    { header:'BCB (M)', dataKey:'bcb' },
    { header:'Awarded (M)', dataKey:'awarded' },
    { header:'Variance (M)', dataKey:'var' },
    { header:'Award Status', dataKey:'award_status' },
    { header:'Contractor', dataKey:'contractor' },
    { header:'Planned Award', dataKey:'plan_date' },
    { header:'Actual Award', dataKey:'act_date' },
    { header:'Proc. Status', dataKey:'proc_status' },
  ];

  // Available width = pgW - mg*2; column widths tuned to exactly fit (single + multi-project)
  const avail = pgW - mg * 2;
  const fmtMM = v => v != null ? ((v)/1e6).toFixed(2) : '-';
  const tableRows = sorted.map(w => {
    const v = (w.approved_budget_bcb||0) - (w.total_awarded||0);
    return {
      project_id: w.project_id||'-',
      wp_no: w.wp_no||'-',
      trade: w.trade||'-',
      works: w.works||'-',
      description: w.description||'-',
      bcb: fmtMM(w.approved_budget_bcb),
      awarded: w.total_awarded ? fmtMM(w.total_awarded) : '-',
      var: w.approved_budget_bcb ? (v>=0?'+':'')+fmtMM(v) : '-',
      award_status: w.award_status||'-',
      contractor: w.contractor||'-',
      plan_date: fmtDate(w.awarding_date),
      act_date: fmtDate(w.actual_awarding_date),
      proc_status: w.procurement_status||'-',
    };
  });

  doc.autoTable({
    columns: baseCols,
    body: tableRows,
    startY: 43,
    tableWidth: avail,
    margin: { top: 43, left:mg, right:mg, bottom: sigH + 6 },
    theme: 'grid',
    headStyles: { fillColor:[35,31,32], textColor:[255,255,255], fontSize:6.5, fontStyle:'bold', halign:'center', cellPadding:2, minCellHeight:8 },
    bodyStyles: { fontSize:6.5, cellPadding:[2,2,2,2], textColor:[50,50,50], minCellHeight:7 },
    alternateRowStyles: { fillColor:[250,250,250] },
    styles: { overflow:'linebreak', lineColor:[220,220,220], lineWidth:0.2 },
    columnStyles: {
      project_id:  { halign:'center', cellWidth: multiProject ? 16 : 0 },
      wp_no:       { halign:'center', cellWidth:12 },
      trade:       { cellWidth:22 },
      works:       { cellWidth:20 },
      description: { cellWidth: multiProject ? 42 : 48 },
      bcb:         { halign:'right',  cellWidth:15 },
      awarded:     { halign:'right',  cellWidth:15 },
      var:         { halign:'right',  cellWidth:15 },
      award_status:{ halign:'center', cellWidth:19 },
      contractor:  { cellWidth:25 },
      plan_date:   { halign:'center', cellWidth:18 },
      act_date:    { halign:'center', cellWidth:18 },
      proc_status: { halign:'center', cellWidth:18 },
    },
    willDrawPage: (data) => {
      drawHeader(data.pageNumber);
    },
  });

  // Draw page numbers and signatures now that we know total pages
  const totalPg = doc.getNumberOfPages();
  for (let i = 1; i <= totalPg; i++) {
    doc.setPage(i);
    drawPageNum(i, totalPg);
    if (i === totalPg) drawSignatures();
  }

  doc.save(`WPM_${label}_${new Date().toISOString().slice(0,10)}.pdf`);
}

function updatePendingBadge() {
  WPDb.getPendingWPs().then(wps=>{
    const badge=document.getElementById('review-badge');
    if (badge) { badge.textContent=wps.length; badge.style.display=wps.length>0?'inline-block':'none'; }
  }).catch(()=>{});
}

/* â”€â”€ Global New Project Modal (overridden by admin.html's own version) â”€â”€ */
(function() {
  let _gnpUsers = [];

  function _gnpGetOrCreate() {
    let m = document.getElementById('gnp-global-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'gnp-global-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:3000;align-items:center;justify-content:center;padding:16px';
    m.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:100%;max-width:460px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.2)">
        <div style="padding:20px 20px 0;flex-shrink:0">
          <div style="font-size:16px;font-weight:700;color:#231F20;margin-bottom:4px">New Project</div>
          <div style="font-size:13px;color:#888;margin-bottom:16px">Create a new EPC project and assign users</div>
        </div>
        <div style="padding:0 20px 16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px">
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Project Code * <span style="font-size:9px;font-weight:400;text-transform:none">(letters/numbers only, e.g. AVR102)</span></div>
            <input id="gnp-id" type="text" placeholder="e.g. AVR102" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Project Name *</div>
            <input id="gnp-name" type="text" placeholder="e.g. Avesta Residences Tower 2"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Location</div>
            <input id="gnp-location" type="text" placeholder="e.g. Quezon City"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Description</div>
            <input id="gnp-description" type="text" placeholder="Optional project description"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Budget BCB (â‚±)</div>
            <input id="gnp-budget" type="number" placeholder="e.g. 274900000"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Assign Users (optional)</div>
            <div id="gnp-user-list"><div style="color:#aaa;font-size:12px">Loadingâ€¦</div></div>
          </div>
          <div id="gnp-error" style="display:none;background:#FEE2E2;color:#991B1B;border-radius:8px;padding:10px 12px;font-size:13px"></div>
        </div>
        <div style="padding:12px 20px 20px;flex-shrink:0;border-top:1px solid #f0f0f0;display:flex;gap:10px">
          <button onclick="window._gnpConfirm()" id="gnp-create-btn"
            style="flex:1;padding:10px;background:#EE3124;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer">
            <i class="ti ti-plus" style="font-size:14px;margin-right:4px;vertical-align:middle"></i> Create Project
          </button>
          <button onclick="window._gnpClose()"
            style="padding:10px 16px;background:transparent;color:#666;border:1px solid #e5e5e5;border-radius:8px;font-size:14px;font-family:inherit;cursor:pointer">Cancel</button>
        </div>
      </div>`;
    m.addEventListener('click', e => { if(e.target===m) window._gnpClose(); });
    document.body.appendChild(m);
    return m;
  }

  window._gnpClose = function() {
    const m = document.getElementById('gnp-global-modal');
    if (m) m.style.display = 'none';
    ['gnp-id','gnp-name','gnp-location','gnp-description','gnp-budget'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    const err=document.getElementById('gnp-error'); if(err) err.style.display='none';
  };

  window._gnpConfirm = async function() {
    const v = id => (document.getElementById(id)?.value||'').trim();
    const id = v('gnp-id'), name = v('gnp-name');
    const errEl = document.getElementById('gnp-error');
    if (!id||!name) { errEl.textContent='Project Code and Name are required.'; errEl.style.display='block'; return; }
    if (!/^[A-Z0-9]+$/.test(id)) { errEl.textContent='Project Code must be letters/numbers only (e.g. AVR102).'; errEl.style.display='block'; return; }
    const budget = parseFloat(document.getElementById('gnp-budget')?.value)||null;
    const selectedUsers = [...document.querySelectorAll('#gnp-user-rows input:checked')].map(cb=>cb.value);
    const btn = document.getElementById('gnp-create-btn');
    btn.textContent='Creatingâ€¦'; btn.disabled=true; errEl.style.display='none';
    try {
      await WPDb.createProject({id, name, location:v('gnp-location'), description:v('gnp-description'), budget_bcb:budget, status:'active'});
      for (const uid of selectedUsers) {
        const user = _gnpUsers.find(u=>u.id===uid);
        if (user) await WPDb.updateUser(uid, {projects:[...new Set([...(user.projects||[]),id])]});
      }
      window._gnpClose();
      const toast = document.createElement('div');
      toast.innerHTML=`<div style="position:fixed;bottom:24px;right:24px;background:#2D9B6F;color:#fff;padding:14px 20px;border-radius:12px;font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:9999">âœ“ Project ${id} created</div>`;
      document.body.appendChild(toast); setTimeout(()=>toast.remove(),3000);
      if (typeof loadData==='function') setTimeout(loadData,500);
      if (typeof loadAll==='function') setTimeout(loadAll,500);
      if (typeof renderOverview==='function') setTimeout(renderOverview,600);
    } catch(err) {
      errEl.textContent=(err.message.includes('duplicate')||err.message.includes('unique'))
        ?`Project Code "${id}" already exists.`:'Error: '+err.message;
      errEl.style.display='block';
      const b=document.getElementById('gnp-create-btn'); b.innerHTML='<i class="ti ti-plus" style="font-size:14px;margin-right:4px;vertical-align:middle"></i> Create Project'; b.disabled=false;
    }
  };

  window.openNewProjectModal = async function() {
    const modal = _gnpGetOrCreate();
    modal.style.display = 'flex';
    const list = document.getElementById('gnp-user-list');
    if (list) list.innerHTML = '<div style="color:#aaa;font-size:12px">Loadingâ€¦</div>';
    try {
      _gnpUsers = await WPDb.getAllUsers();
      const approved = _gnpUsers.filter(u=>u.status==='approved');
      if (list) {
        list.innerHTML = `
          <div style="position:relative;margin-bottom:8px">
            <i class="ti ti-search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:#bbb;font-size:13px"></i>
            <input type="text" placeholder="Search usersâ€¦" oninput="document.querySelectorAll('.gnpu-row').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')"
              style="width:100%;padding:6px 10px 6px 28px;border:1px solid #e5e5e5;border-radius:7px;font-size:12px;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div id="gnp-user-rows" style="display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto">
            ${approved.length?approved.map(u=>`
              <div class="gnpu-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e5e5e5;border-radius:8px;cursor:pointer" onclick="this.querySelector('input').click()">
                <input type="checkbox" value="${u.id}" onclick="event.stopPropagation()" style="width:16px;height:16px;accent-color:#EE3124;cursor:pointer">
                <label onclick="event.preventDefault()" style="cursor:pointer;font-size:13px;pointer-events:none">${u.name||u.email} <span style="font-size:10px;color:#aaa">(${(u.role||'user').replace(/_/g,' ')})</span></label>
              </div>`).join(''):'<div style="color:#aaa;font-size:12px">No approved users</div>'}
          </div>`;
      }
    } catch(e) {
      if (list) list.innerHTML = '<div style="color:#c00;font-size:12px">Could not load users.</div>';
    }
    document.getElementById('gnp-id')?.focus();
  };
})();
