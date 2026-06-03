
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

  const h = ['Project','WP No','Cost Code','Description','Zone','Trade',
    'Procurement Status','Award Status','Planned Award','Actual Award',
    'Lead Time (d)','Target Delivery','Target Completion',
    'Budget BCB (PHP)','Total Awarded (PHP)','Variance (PHP)',
    'Contractor','PO/JO Count','PO/JO Numbers','Remarks'];

  const cell = v => `"${(v??'').toString().replace(/"/g,'""')}"`;
  const rows = sorted.map(w => [
    w.project_id, w.wp_no, w.cost_code, w.description, w.zone, w.trade,
    w.procurement_status, w.award_status, w.awarding_date, w.actual_awarding_date,
    w.awarding_lead_time, w.target_delivery, w.target_completion,
    w.approved_budget_bcb, w.total_awarded, w.variance,
    w.contractor, w.po_jo_count, w.po_jo_numbers, w.remarks
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

function buildRankList(id, items, colorClass, fmtVal) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) { el.innerHTML='<div style="color:#aaa;font-size:12px;padding:8px 0">No data</div>'; return; }
  el.innerHTML = items.map((item,i)=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f5f5f5">
      <span style="font-size:11px;color:#aaa;font-weight:600;width:16px">${i+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:#231F20;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</div>
        <div style="font-size:10px;color:#888">${item.sub}</div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${item.color};white-space:nowrap">${fmtVal(item.val)}</span>
    </div>`).join('');
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
