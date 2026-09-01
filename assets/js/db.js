
/* ── WPDb ─────────────────────────────────────────────────────────── */
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
    // never let a stale read-back of the audit fields be written back verbatim; the
    // stamp is applied fresh on every write via _auditStamp()
    delete d.updated_at; delete d.updated_by; delete d.updated_by_name;
    return d;
  }
  // Per-WP audit trail: stamp who last changed a work package and when, from the logged-in
  // profile. Applied on every insert/update so the WP detail panel can show "Last updated by …".
  // updated_by_name is a snapshot so the display survives even if that user is later removed.
  function _auditStamp() {
    const p = (typeof window !== 'undefined' && window.__profile) || {};
    return { updated_at: new Date().toISOString(), updated_by: p.id || null, updated_by_name: p.name || p.email || null };
  }
  // True if the error is a "column does not exist" (audit columns not migrated yet).
  function _isMissingAuditCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return error.code === '42703' || /updated_by_name|updated_by|updated_at/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripAudit(obj) { const d = {...obj}; delete d.updated_at; delete d.updated_by; delete d.updated_by_name; return d; }
  // Same deploy-order guard for the BCB baseline columns: they only exist once
  // migrations/2026-07-23_bcb_baselines.sql has been run, so every write retries without them.
  function _isMissingBcbCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return /budget_bcb[0-9]/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripBcb(obj) { const d = {...obj}; delete d.budget_bcb0; delete d.budget_bcb1; delete d.budget_bcb2; return d; }
  // Every deploy guard below decides, from a free-text Postgres error, that a column is
  // absent and DROPS it from the payload — then the write succeeds and the caller is told
  // everything saved. That silence is the dangerous part: the two bugs these guards have
  // actually caused were both over-matches that discarded columns the database really had
  // (`/vendor_id/` also matching a `proposed_vendor_ids` error, and _stripBuyback dropping
  // all three buyback fields when only buyback_amount was missing) — and nothing anywhere
  // reported it. Rewriting the matching wouldn't have caught either; SEEING the drop would.
  // So: never strip quietly. If this ever fires for a column whose migration HAS been run,
  // that is a guard bug and this warning is the only thing that will say so.
  function _warnDropped(where, before, after, error) {
    const gone = Object.keys(before).filter(k => !(k in after));
    if (!gone.length) return;
    console.warn('[WPDb] ' + where + ': dropped ' + gone.join(', ') +
      ' — this database appears not to have those column(s), so they were NOT saved.' +
      ' If the migration for them has already been run, this is a false positive in the' +
      ' missing-column guard, not a schema problem. Postgres said: ' +
      ((error && (error.message || error.details)) || 'unknown'));
  }
  function _warn2(before, after, error) { _warnDropped('insert retry', before, after, error); return after; }
  // Retry helper: strip whichever optional column set the DB is missing, then try again.
  function _stripOptional(obj, error) {
    let d = _stripAudit(obj);
    if (_isMissingBcbCol(error)) d = _stripBcb(d);
    if (_isMissingVendorCol(error)) d = _stripVendor(d);
    if (_isMissingProposedVendorIdsCol(error)) d = _stripProposedVendorIds(d);
    if (_isMissingAwardedVendorIdsCol(error)) d = _stripAwardedVendorIds(d);
    if (_isMissingBuybackCol(error)) d = _stripBuyback(d, error);
    if (_isMissingFreeOfChargeCol(error)) d = _stripFreeOfCharge(d);
    _warnDropped('write retry', obj, d, error);
    return d;
  }
  // Same deploy-order guard again for projects.group_head (migrations/2026-08-06_project_group_head.sql):
  // every project write retries without the column if the DB hasn't been migrated yet.
  function _isMissingGroupHeadCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return /group_head/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripGroupHead(obj) { const d = {...obj}; delete d.group_head; return d; }
  // Same deploy-order guard for work_packages.vendor_id (migrations/2026-08-10_vendor_phase2b.sql):
  // every WP write retries without it if that migration hasn't run yet.
  function _isMissingVendorCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    // \b after "vendor_id" so this does NOT also match "proposed_vendor_ids"
    // (both are word chars — "id"→"s" has no boundary — so the two guards can't cross-trigger).
    return /vendor_id\b/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripVendor(obj) { const d = {...obj}; delete d.vendor_id; return d; }
  // Same deploy-order guard for work_packages.proposed_vendor_ids (migrations/2026-08-10_wp_proposed_vendor_ids.sql):
  // every WP write retries without it if that migration hasn't run yet. Precise match on the full
  // column name so this can never cross-trigger with _isMissingVendorCol above (or vice versa).
  function _isMissingProposedVendorIdsCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return /proposed_vendor_ids/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripProposedVendorIds(obj) { const d = {...obj}; delete d.proposed_vendor_ids; return d; }
  // Same deploy-order guard for the awarded-vendor columns (migrations/2026-08-11_wp_awarded_vendor_ids.sql:
  // awarded_vendor_ids + awarded_vendor_amounts). Every WP write retries without them if that
  // migration hasn't run yet. Precise column-name match so it can't cross-trigger with
  // _isMissingVendorCol (vendor_id\b) or _isMissingProposedVendorIdsCol.
  function _isMissingAwardedVendorIdsCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return /awarded_vendor_(ids|amounts)/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripAwardedVendorIds(obj) { const d = {...obj}; delete d.awarded_vendor_ids; delete d.awarded_vendor_amounts; return d; }
  // Same deploy-order guard for the buyback columns (migrations/2026-08-11_wp_buyback.sql:
  // buyback + buyback_depreciation_percent). Every WP write retries without them if
  // that migration hasn't run yet.
  function _isMissingBuybackCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return /buyback/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  // Strip only what the error actually names: an environment that has `buyback` but not the
  // newer `buyback_amount` must still persist the flag (and the %), so a blanket strip of all
  // three would silently discard columns the DB can accept.
  function _stripBuyback(obj, error) {
    const d = {...obj};
    const m = error ? ((error.message || '') + (error.details || '')) : '';
    const named = /buyback_amount/.test(m) || /buyback_depreciation_percent/.test(m);
    if (!named || /buyback_amount/.test(m)) delete d.buyback_amount;
    if (!named || /buyback_depreciation_percent/.test(m)) delete d.buyback_depreciation_percent;
    if (!named) delete d.buyback;   // the base column itself is missing -> drop the whole set
    return d;
  }
  // Same deploy-order guard for work_packages.free_of_charge (migrations/2026-08-25_wp_free_of_charge.sql):
  // every WP write retries without it if that migration hasn't run yet. Precise match --
  // the substring appears in no other column name, so it can't cross-trigger.
  function _isMissingFreeOfChargeCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return /free_of_charge/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripFreeOfCharge(obj) { const d = {...obj}; delete d.free_of_charge; return d; }
  // A retry can strip a patch down to nothing (e.g. the grid staged ONLY a buyback edit on a
  // DB that lacks those columns). PostgREST treats an empty update body as 0 rows, so .single()
  // then throws an opaque "Cannot coerce the result to a single JSON object". Nothing is
  // persistable in that case, so return the row unchanged rather than surfacing a fake failure.
  async function _retryUpdate(sb, id, patch) {
    if (!patch || Object.keys(patch).length === 0) {
      console.warn('[WPDb] Nothing left to write after dropping columns this database does not have (pending migration). No changes saved for WP', id);
      const r = await sb.from('work_packages').select('*').eq('id', id).single();
      return { data: r.data, error: null };
    }
    return await sb.from('work_packages').update(patch).eq('id', id).select().single();
  }
  async function getProjects() { const sb=await getSB(); const {data}=await sb.from('projects').select('*').order('id'); return data||[]; }
  async function getProject(id) { const sb=await getSB(); const {data}=await sb.from('projects').select('*').eq('id',id).single(); return data; }
  async function saveProject(d) { const sb=await getSB(); const {data}=await sb.from('projects').upsert(d,{onConflict:'id'}).select().single(); return data; }
  // Read relation (S4): non-viewers read the base work_packages table (with cost). Viewers are
  // blocked from the table by RLS and instead read the cost-free security-definer view
  // `wp_view_public`. Memoized probe; if the view doesn't exist yet (migration not run) we fall
  // back to the table so nothing hard-breaks (viewers just still see cost until the DB is migrated).
  let _wpRelCache=null;
  async function _wpRel() {
    if (!(typeof window!=='undefined' && window.__wpmRole==='viewer')) return 'work_packages';
    if (_wpRelCache) return _wpRelCache;
    try { const sb=await getSB(); const {error}=await sb.from('wp_view_public').select('id').limit(1); _wpRelCache = error ? 'work_packages' : 'wp_view_public'; }
    catch(_) { _wpRelCache='work_packages'; }
    return _wpRelCache;
  }
  // PostgREST caps a single SELECT at a default of 1000 rows, so a plain
  // .select() silently truncates once a table (vendors, work_packages) grows past
  // that — the "exactly 1000" symptom. Fetch ALL rows by paging with .range().
  // `makeQuery` MUST return a FRESH query builder each call (a builder is consumed
  // once awaited), e.g. () => sb.from('t').select('*').order('id').
  async function _pagedSelect(makeQuery) {
    const PAGE = 1000; let all = [], from = 0;
    for (;;) {
      const { data, error } = await makeQuery().range(from, from + PAGE - 1);
      if (error) throw error;
      const batch = data || [];
      all = all.concat(batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }
  async function getApprovedWPs(pid) { const sb=await getSB(); const rel=await _wpRel(); const rows=await _pagedSelect(()=>{ let q=sb.from(rel).select('*').eq('review_status','approved'); if(pid) q=q.eq('project_id',pid); return q.order('wp_no'); }); return rows.map(mapWP); }
  async function getAllWPs(pid) { const sb=await getSB(); const rel=await _wpRel(); const rows=await _pagedSelect(()=>{ let q=sb.from(rel).select('*'); if(pid) q=q.eq('project_id',pid); return q.order('wp_no'); }); return rows.map(mapWP); }
  async function getAllApprovedWPs() { return getApprovedWPs(null); }
  // SCHEDULE NEED-BY dates pushed in by the Planners app (migrations/2026-08-20_planners_need_by.sql).
  // Keyed by wp_no, returned as a { WP_NO: row } map because every caller looks a package's
  // date up rather than iterating the list.
  //
  // ⚠️ Read-only here by design. The table has no write policy for authenticated users —
  // the Planners `push-need-by` Edge Function owns it via the service role. A buyer who wants
  // a different date changes their OWN target_installation; they never edit the schedule's.
  //
  // ⚠️ Returns {} on ANY failure, including "table does not exist" — the migration may not be
  // run yet, and a missing need-by column must degrade to "no dates shown" rather than break
  // the whole WP list. Same tolerance getAllWPs applies to wp_view_public.
  async function getNeedBy(pid) {
    try {
      const sb = await getSB();
      const rows = await _pagedSelect(() => {
        let q = sb.from('planners_need_by').select('wp_no,need_by,driver_activity_id,driver_activity_name,linked_activities,schedule_data_date,synced_at');
        if (pid) q = q.eq('project_id', pid);
        return q.order('wp_no');
      });
      const out = {};
      (rows || []).forEach(r => { const k = String(r.wp_no ?? '').trim().toUpperCase(); if (k) out[k] = r; });
      return out;
    } catch (_) { return {}; }
  }
  // ---- Contract packages, mirrored from the Planners app --------------------------
  // A project is bought as several contract packages ("Package 1 — Tower 1 and General
  // Requirements", "Package 2 — Towers 2-7"). Planners owns them; this app files work
  // packages under them so spend and awards can be read per contract lot.
  //
  // ⚠️ Read-only here by design, exactly like getNeedBy. `planners_packages` has no
  // write policy for authenticated users — the Planners `push-packages` Edge Function
  // owns it via the service role. A contract package invented in a browser could end up
  // cited in a purchase order nobody agreed to.
  //
  // ⚠️ Returns [] on ANY failure, including "table does not exist": the migration may
  // not be run yet, and a missing package list must degrade to "no packages offered"
  // rather than break the WP form.
  async function getPlannerPackages(pid) {
    try {
      const sb = await getSB();
      const rows = await _pagedSelect(() => {
        let q = sb.from('planners_packages')
          .select('planners_package_id,code,name,status,sort_order,contract_amount,project_id');
        if (pid) q = q.eq('project_id', pid);
        return q.order('sort_order');
      });
      return rows || [];
    } catch (_) { return []; }
  }

  async function getApprovedWPsForProjects(ids) { if(!ids||!ids.length) return []; const sb=await getSB(); const rel=await _wpRel(); const rows=await _pagedSelect(()=>sb.from(rel).select('*').eq('review_status','approved').in('project_id',ids).order('wp_no')); return rows.map(mapWP); }
  async function getPendingWPs() { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').eq('review_status','pending_review').order('created_at',{ascending:false}); return (data||[]).map(mapWP); }
  async function getAllWPsForAdmin() { const sb=await getSB(); const rows=await _pagedSelect(()=>sb.from('work_packages').select('*').order('created_at',{ascending:false})); return rows.map(mapWP); }
  async function getAllWPsForProjects(ids) { if(!ids||!ids.length) return []; const sb=await getSB(); const rows=await _pagedSelect(()=>sb.from('work_packages').select('*').in('project_id',ids).order('created_at',{ascending:false})); return rows.map(mapWP); }
  async function getOfficerWPs(uid) { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').eq('assigned_officer',uid).order('wp_no'); return (data||[]).map(mapWP); }
  async function getWP(id) { const sb=await getSB(); const {data}=await sb.from(await _wpRel()).select('*').eq('id',id).single(); return mapWP(data); }
  async function getProjectWPs(pid) { return getAllWPs(pid); }
  async function submitWP(d,p) {
    const sb=await getSB(); const base={...unmap(d),review_status:'pending_review',assigned_officer:p?.id||null};
    let {data,error}=await sb.from('work_packages').insert({...base,..._auditStamp()}).select().single();
    if(error && (_isMissingAuditCol(error) || _isMissingBcbCol(error) || _isMissingVendorCol(error) || _isMissingProposedVendorIdsCol(error) || _isMissingAwardedVendorIdsCol(error) || _isMissingBuybackCol(error) || _isMissingFreeOfChargeCol(error)))
      ({data,error}=await sb.from('work_packages').insert(_stripOptional(base,error)).select().single());
    if(error && _isMissingBcbCol(error))
      ({data,error}=await sb.from('work_packages').insert(_warn2(base,_stripBcb(_stripAudit(base)),error)).select().single());
    if(error && _isMissingVendorCol(error))
      ({data,error}=await sb.from('work_packages').insert(_warn2(base,_stripVendor(_stripAudit(base)),error)).select().single());
    if(error && _isMissingProposedVendorIdsCol(error))
      ({data,error}=await sb.from('work_packages').insert(_warn2(base,_stripProposedVendorIds(_stripAudit(base)),error)).select().single());
    if(error) throw error; return data;
  }
  async function updateWP(id,d) {
    const sb=await getSB(); const base={...unmap(d),review_status:'pending_review'};
    let {data,error}=await sb.from('work_packages').update({...base,..._auditStamp()}).eq('id',id).select().single();
    if(error && (_isMissingAuditCol(error) || _isMissingBcbCol(error) || _isMissingVendorCol(error) || _isMissingProposedVendorIdsCol(error) || _isMissingAwardedVendorIdsCol(error) || _isMissingBuybackCol(error) || _isMissingFreeOfChargeCol(error)))
      ({data,error}=await _retryUpdate(sb,id,_stripOptional(base,error)));
    if(error && _isMissingBcbCol(error))
      ({data,error}=await _retryUpdate(sb,id,_stripBcb(_stripAudit(base))));
    if(error && _isMissingVendorCol(error))
      ({data,error}=await _retryUpdate(sb,id,_stripVendor(_stripAudit(base))));
    if(error && _isMissingProposedVendorIdsCol(error))
      ({data,error}=await _retryUpdate(sb,id,_stripProposedVendorIds(_stripAudit(base))));
    if(error) throw error; return data;
  }
  async function updateWPDirect(id,d) {
    const sb=await getSB(); const base=unmap(d);
    let {data,error}=await sb.from('work_packages').update({...base,..._auditStamp()}).eq('id',id).select().single();
    if(error && (_isMissingAuditCol(error) || _isMissingBcbCol(error) || _isMissingVendorCol(error) || _isMissingProposedVendorIdsCol(error) || _isMissingAwardedVendorIdsCol(error) || _isMissingBuybackCol(error) || _isMissingFreeOfChargeCol(error)))
      ({data,error}=await _retryUpdate(sb,id,_stripOptional(base,error)));
    if(error && _isMissingBcbCol(error))
      ({data,error}=await _retryUpdate(sb,id,_stripBcb(_stripAudit(base))));
    if(error && _isMissingVendorCol(error))
      ({data,error}=await _retryUpdate(sb,id,_stripVendor(_stripAudit(base))));
    if(error && _isMissingProposedVendorIdsCol(error))
      ({data,error}=await _retryUpdate(sb,id,_stripProposedVendorIds(_stripAudit(base))));
    if(error) throw error; return data;
  }
  async function createProject(d) {
    const sb=await getSB();
    let {data,error}=await sb.from('projects').insert(d).select().single();
    if(error && _isMissingGroupHeadCol(error))
      ({data,error}=await sb.from('projects').insert(_stripGroupHead(d)).select().single());
    if(error) throw error; return data;
  }
  async function approveWP(id) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({review_status:'approved'}).eq('id',id).select().single(); return data; }
  async function rejectWP(id,_,reason) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({review_status:'rejected',review_notes:reason}).eq('id',id).select().single(); return data; }
  async function assignOfficer(id,uid) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({assigned_officer:uid}).eq('id',id).select().single(); return data; }
  async function deleteWP(id) { const sb=await getSB(); const {error}=await sb.from('work_packages').delete().eq('id',id); if(error) throw error; }
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
  // COMPLETE user removal (admin "Remove user"). Purges BOTH the public.users profile row
  // AND the auth.users record via the public.admin_delete_user() SECURITY DEFINER RPC
  // (migrations/2026-07-09_admin_delete_user.sql) — the auth schema isn't writable by the client, so the
  // server-side function does the auth purge after re-checking the caller is an admin. This
  // frees the email for re-registration (Planning-App parity). Falls back to a profile-only
  // delete if the RPC doesn't exist yet (safe to deploy before the migration runs) — without
  // a profile the user still fails AppAuth.requireLogin (signed out), so access is revoked.
  async function deleteUser(id) {
    const sb = await getSB();
    const { error } = await sb.rpc('admin_delete_user', { target_id: id });
    if (error) {
      // 404/PGRST202 = function not created yet → fall back to profile-only delete.
      const missing = error.code === 'PGRST202' || /not exist|could not find|schema cache/i.test(error.message || '');
      if (!missing) throw error;
      const { error: delErr } = await sb.from('users').delete().eq('id', id);
      if (delErr) throw delErr;
    }
  }
  async function archiveProject(id) { const sb=await getSB(); const {error}=await sb.from('projects').update({status:'archived'}).eq('id',id); if(error) throw error; }
  async function unarchiveProject(id) { const sb=await getSB(); const {error}=await sb.from('projects').update({status:'active'}).eq('id',id); if(error) throw error; }
  async function updateProject(id,data) {
    const sb=await getSB();
    let {data:d,error}=await sb.from('projects').update(data).eq('id',id).select().single();
    if(error && _isMissingGroupHeadCol(error))
      ({data:d,error}=await sb.from('projects').update(_stripGroupHead(data)).eq('id',id).select().single());
    if(error) throw error; return d;
  }
  async function deleteProject(id) { const sb=await getSB(); await sb.from('work_packages').delete().eq('project_id',id); const {error}=await sb.from('projects').delete().eq('id',id); if(error) throw error; }
  async function seedWP(d) { return submitWP(d,null); }
  return { getProjects,getProject,saveProject,createProject,getApprovedWPs,getAllWPs,getNeedBy,getPlannerPackages,getAllApprovedWPs,getApprovedWPsForProjects,getPendingWPs,getAllWPsForAdmin,getAllWPsForProjects,getOfficerWPs,getWP,getProjectWPs,submitWP,updateWP,updateWPDirect,approveWP,rejectWP,assignOfficer,deleteWP,getAllUsers,getUsersForAdmin,getAdminUsers,getManagerUsers,updateUser,updateLastLogin,deleteUser,archiveProject,unarchiveProject,updateProject,deleteProject,seedWP };
})();

/* ── Stats ─────────────────────────────────────────────────────────── */
function computeStats(wps) {
  const total=wps.length;
  // Awarded count / budget / awarded cost come from the WP-Monitoring Helping Sheet (authoritative)
  // via helpingMetrics; falls back to row-derived values for projects not in HELPING_FIGURES.
  const hm=helpingMetrics(wps);
  const awarded=hm.awarded;
  const notAwarded=Math.max(0,total-awarded);
  const totalBudget=hm.totalBudget;
  const totalContract=hm.awardedCost;
  const variance=totalBudget-totalContract;
  const today=new Date();
  const late=wps.filter(w=>!window.isResolved(w)&&w.awarding_date&&new Date(w.awarding_date)<today).length;
  return {total,awarded,notAwarded,totalBudget,totalContract,variance,late,awardRate:total?Math.round(awarded/total*100):0};
}

/* ── Awarded metrics are now FULLY ROW-DERIVED (no Helping Sheet) ──
   All six projects (AVR/GRP/OPW/SLN/SLT/UTM) were reconciled against their WP-Monitoring files and
   the row-derived basis below reproduces their Helping Sheets (and CORRECTS AVR101, whose Helping
   Sheet under-counted by ₱8.9M due to a date-gated SUMIFS that dropped awarded WPs with a blank
   actual-award date or below its hardcoded row range). So HELPING_FIGURES is now EMPTY — every
   project (incl. all future ones) computes from its rows, self-maintaining and immune to those
   spreadsheet leaks. The dict + override branch are kept only as an escape hatch if a project's row
   data is ever found to be unusable; prefer fixing the rows instead. Use project.html?id=<PID>&diag=1
   to inspect a project's awarded reconciliation. */
const HELPING_FIGURES = {};
// A WP is "resolved" — done, no longer sitting in the active backlog — when it's
// genuinely Awarded, OR flagged `not_to_be_awarded` (Ops decided it will NEVER go
// through a formal award: handled outside PRC entirely — petty cash, direct
// arrangement, scope removed). Requiring Procurement Status to be set to "Awarded"
// before the flag "counted" was a contradiction in the UI (the WP form would say
// "Award Status: Awarded" right next to "Not to be Awarded: Yes") — so this check
// is deliberately independent of award_status. Use it everywhere a WP's "is this
// done / not backlog" state matters — awarded counts, Due-Not-Awarded / Not-Due
// splits, Backlog tables — never re-inline `award_status==='Awarded'` (or its
// negation) for that purpose, or a not_to_be_awarded WP with Procurement Status
// left honest (not set to "Awarded") will still show stuck in the backlog forever
// while the KPI cards already treat it as closed.
window.isResolved = function (w) {
  return !!w && (w.award_status === 'Awarded' || !!w.not_to_be_awarded);
};
// A WP is "money awarded" when it's genuinely Awarded with a real cost, OR it's
// flagged `not_to_be_awarded` (see isResolved above) — its budget is realized
// savings at an effective ₱0 cost rather than data pending entry. Without this
// flag a WP like that is indistinguishable from "Awarded, cost not encoded yet"
// and gets dropped from BOTH sides of the ledger (Known Issue #17) instead of
// counting as real savings. Deliberately does NOT require award_status==='Awarded'
// (see isResolved) — the flag alone is sufficient. Use these two helpers
// everywhere the app decides whether a WP's money counts and what its effective
// awarded cost is — never re-inline `award_status==='Awarded' && total_awarded>0`,
// or a not_to_be_awarded WP will disagree between tabs/charts again.
//
// ⚠️ AN AWARDED WP COUNTS, WHATEVER ITS COST -- INCLUDING PHP 0 (2026-08-25, PMO ruling).
// This function used to additionally require `total_awarded > 0`, so an Awarded WP with a
// zero/blank cost fell out of BOTH sides of the money ledger (the old Known Issue #17).
// That was withdrawn because the threshold had no defensible position: a WP awarded at
// PHP 0.01 was treated as a real award booking almost its whole BCB as savings, while the
// very same WP at PHP 0.00 was treated as missing data and dropped. Per the PMO, an award
// is an award and a zero cost is a real cost -- so its full BCB is realized savings.
//
// Consequences, all intended:
//   * `Balance to Award` (totalBudget - budgetAwarded) now equals the BACKLOG's budget
//     exactly, so the card's label is finally true and its WP count matches the Backlog
//     table (AVR101: PHP 1.00M / 1 WP, was PHP 9.37M / 7).
//   * Portfolio savings rose PHP 84.33M across 65 previously-excluded WPs.
//   * This is now IDENTICAL to isResolved(), so it delegates rather than restating the
//     rule -- two copies would silently drift. Both names are kept because call sites
//     read very differently ("is this in the backlog?" vs "does its money count?").
//   * `free_of_charge` no longer changes the money (a plain 0 now behaves the same). The
//     flag is retained: it records INTENT ("deliberately free" vs "cost not keyed yet")
//     and still waives the Awarded-Cost requirement in the WP form and the review grid.
// The cost of this ruling: an awarded WP whose cost merely hasn't been entered now books
// its BCB as savings. 55 of those 65 WPs also have no vendor recorded -- Action Center ->
// Data Gaps still lists them, which is where that gets caught.
window.isMoneyAwarded = function (w) {
  return window.isResolved(w);
};
// A not-resolved WP with no Planned Award Date is silently excluded from every
// "Cumulative Planned" line (period charts, S-Curve) but IS counted in "Forecast"
// (which treats no-plan as "due next period") — so Forecast can visibly climb
// above Planned's own ceiling on a project with this data gap (Known Issue #32).
// Shared so every period-chart panel's footnote reads the same count.
window.wpMissingPlanCount = function (wps) {
  return (wps || []).filter(w => !window.isResolved(w) && !w.awarding_date).length;
};
// BUYBACK: a WP procured under a buyback arrangement has part of its awarded cost
// recovered when the vendor takes the item back, so only the DEPRECIATED (consumed)
// portion is real spend. The depreciation % is how much value is lost, so:
//   buybackValue        = awarded_cost x (1 - depreciation%)   <- recovered, counts as savings
//   effectiveAwardedCost = awarded_cost x depreciation%        <- what actually stays spent
// Returns 0 for a non-buyback WP (or one with no depreciation % / no cost yet), so
// callers can add it unconditionally. Fraction is clamped to 0..1 so a bad stored
// value can't produce a negative cost or a buyback bigger than the award.
window.buybackDepFraction = function (w) {
  if (!w || !w.buyback) return null;
  const raw = w.buyback_depreciation_percent;
  if (raw === null || raw === undefined || raw === '') return null;
  const f = parseFloat(raw);
  if (!isFinite(f)) return null;
  return Math.max(0, Math.min(1, f));
};
// The buyback can be entered EITHER as a depreciation % OR as an exact amount. An exact
// `buyback_amount` WINS (it's the figure the user actually typed); the % is used otherwise.
// Returns null when this WP has no usable exact amount.
window.buybackExactAmount = function (w) {
  if (!w || !w.buyback) return null;
  const raw = w.buyback_amount;
  if (raw === null || raw === undefined || raw === '') return null;
  const v = parseFloat(raw);
  if (!isFinite(v)) return null;
  // Can never recover more than was awarded, nor a negative amount.
  return Math.max(0, Math.min(v, (w.total_awarded || 0)));
};
window.buybackValue = function (w) {
  // NTBA and free-of-charge are already booked at an effective PHP 0 -- nothing to recover.
  if (!w || !w.buyback || w.not_to_be_awarded || w.free_of_charge) return 0;
  const exact = window.buybackExactAmount(w);
  if (exact !== null) return exact;
  const f = window.buybackDepFraction(w);
  if (f === null) return 0;
  return ((w.total_awarded || 0)) * (1 - f);
};
window.effectiveAwardedCost = function (w) {
  // Both flags mean "this award costs us nothing": NTBA was pulled from the pipeline,
  // free_of_charge was awarded at PHP 0. Either way the full BCB lands in savings.
  if (w && (w.not_to_be_awarded || w.free_of_charge)) return 0;
  const cost = (w && w.total_awarded) || 0;
  if (!w || !w.buyback) return cost;
  const bv = window.buybackValue(w);
  return Math.max(0, cost - bv);
};
// Aggregate awarded metrics over a set of WPs (grouped by project), row-derived.
function helpingMetrics(wps) {
  const byProj = {};
  (wps||[]).forEach(w => { (byProj[w.project_id] = byProj[w.project_id] || []).push(w); });
  let awarded=0, totalBudget=0, awardedCost=0, budgetAwarded=0, hsCovered=true, buybackTotal=0;
  Object.keys(byProj).forEach(pid => {
    const arr = byProj[pid], hs = HELPING_FIGURES[pid];
    if (hs) {
      awarded += hs.awarded; totalBudget += hs.budget;
      awardedCost += hs.awardedCost; budgetAwarded += hs.budgetAwarded;
    } else {
      // STRICTER awarded definition: a WP counts as awarded only when award_status==='Awarded' AND it
      // carries an award amount (total_awarded>0) — "if it's awarded, it must have an awarded cost".
      // Awarded count, Awarded Cost AND Budget-for-Awarded all use this SAME set so they reconcile
      // with each other, with the chart/forecast, and with the source Helping Sheets. This rejects
      // both failure modes seen in the data: provisional costs sitting on "Not yet Awarded" WPs
      // (GRP/SLN/SLT over-count) and the Helping Sheet's date/row leaks (AVR under-count).
      hsCovered = false;
      // COUNT basis: every WP that's "resolved" (award_status==='Awarded', OR flagged
      // not_to_be_awarded — see isResolved). A WP that has genuinely been awarded but
      // whose cost hasn't been encoded yet is still an awarded WP — excluding it made
      // the Overview disagree with the WP List (CCM302 read 39 against a list of 40,
      // OPW101 64 against 62). Provisional costs on Not-Yet-Awarded rows are still excluded,
      // because that is decided by award_status, which the importer takes from the sheet's
      // own Remarks flag rather than from the presence of a cost.
      const awdAll = arr.filter(w => window.isResolved(w));
      // MONEY basis: only awarded WPs that actually carry a cost, OR are flagged
      // not_to_be_awarded (their budget is realized savings at an effective ₱0
      // cost — see isMoneyAwarded). Awarded Cost and Budget-for-Awarded must move
      // together — counting a costless WP's budget here would otherwise book its
      // entire BCB as "savings" while its real cost is still pending.
      const awd = awdAll.filter(w => window.isMoneyAwarded(w));
      awarded += awdAll.length;
      totalBudget += arr.reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
      awardedCost += awd.reduce((s,w)=>s+window.effectiveAwardedCost(w),0);
      budgetAwarded += awd.reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
      // Buyback recovery over the SAME money-awarded set, kept as a separate figure —
      // NOT folded into awardedCost here (that stays the real, effective spend, so
      // Actual Award / CTC / EAC keep reflecting genuine cash flow). Callers that want
      // a "Savings/Loss excluding buyback" figure compute it as
      // (budgetAwarded - awardedCost - buybackTotal), i.e. against the RAW awarded cost,
      // and show buybackTotal as a separate "(+₱X Buyback)" annotation — per explicit
      // 2026-08-12 request not to silently auto-fold buyback into the headline number.
      buybackTotal += awd.reduce((s,w)=>s+(w.buyback?window.buybackValue(w):0),0);
    }
  });
  return {awarded, totalBudget, awardedCost, budgetAwarded, hsCovered, buybackTotal};
}

// Savings/Loss display, with buyback broken out as a separate annotation instead of
// silently folded into the headline number (2026-08-12, explicit request). `hm` is a
// helpingMetrics() result. `hm.awardedCost` is already buyback-netted (effective spend,
// used unchanged by Actual Award/CTC/EAC elsewhere), so the COMBINED savings figure
// (budgetAwarded − awardedCost) already has buyback's benefit baked in; subtracting
// hm.buybackTotal back out gives the RAW savings (as if buyback recovery didn't happen),
// which is what's now shown as the primary number, with buyback shown alongside it.
window.fmtSavingsBuyback = function (hm) {
  const combined = (hm.budgetAwarded || 0) - (hm.awardedCost || 0);
  const bb = hm.buybackTotal || 0;
  const raw = combined - bb;
  const rawPct = hm.budgetAwarded ? (raw / hm.budgetAwarded * 100) : 0;
  const bbPct = hm.budgetAwarded ? (bb / hm.budgetAwarded * 100) : 0;
  const cls = raw >= 0 ? 'green' : 'red';
  const color = raw >= 0 ? '#2D9B6F' : '#EE3124';
  const sign = raw >= 0 ? '+' : '-';
  const hasBB = bb > 0.5; // ignore rounding dust
  // Own line (display:block) — the KPI value is white-space:nowrap;overflow:hidden,
  // so an inline annotation gets clipped mid-word on narrow cards.
  const bbMoneyNote = hasBB ? `<span style="display:block;font-size:0.5em;font-weight:600;color:#888;line-height:1.4;overflow:hidden;text-overflow:ellipsis">+${Fmt.moneyShort(bb)} Buyback</span>` : '';
  const bbPctNote = hasBB ? ` <span style="font-weight:600;color:#888">(+${bbPct.toFixed(1)}% Buyback)</span>` : '';
  return {
    val: sign + Fmt.moneyShort(Math.abs(raw)) + bbMoneyNote,
    full: sign + Fmt.moneyFull(Math.abs(raw)) + (hasBB ? ' (+' + Fmt.moneyFull(bb) + ' Buyback recovery, shown separately)' : ''),
    sub: (raw >= 0 ? '+' : '') + rawPct.toFixed(1) + '%' + bbPctNote,
    cls, color, raw, bb,
  };
};

/* ── Status glyphs — never encode meaning in colour alone ──────────────────
   Award/procurement/submittal/delivery states were distinguished ONLY by red vs
   green, which ~8% of men cannot reliably tell apart (and which disappears in a
   greyscale print of the PDF export). Every status label now carries a leading
   glyph, so the state is readable without perceiving colour at all.
   `window.statusGlyph(text)` returns the marker for a status string. */
const _STATUS_GLYPHS = [
  [/^awarded$/i,                         '✔'],   // ✔ done
  [/not yet awarded|not awarded/i,       '○'],   // ○ open
  [/^delivered$|^approved$/i,            '✔'],
  [/approved w\/ comments/i,             '✓'],   // ✓ done, with caveats
  [/^submitted$|manufactured|produced/i, '◐'],   // ◐ in progress
  [/detailed drawings|dp paid/i,         '◐'],
  [/evaluated|solicited|sourced/i,       '◐'],
  [/not started|not required/i,          '○'],
  [/overdue|due not awarded|rejected/i,  '⚠'],   // ⚠ needs attention
  [/pending/i,                           '⏱'],   // ⏱ waiting
];
function statusGlyph(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return '';
  for (const [re, g] of _STATUS_GLYPHS) if (re.test(t)) return g;
  return '';
}
// Convenience: "✔ Awarded" — the glyph is aria-hidden so screen readers, which
// already read the status word, don't announce a meaningless symbol.
function statusLabel(text) {
  const g = statusGlyph(text);
  const t = (text == null || text === '') ? '—' : String(text);
  return g ? '<span aria-hidden="true" style="opacity:.85">' + g + '</span> ' + t : t;
}
window.statusGlyph = statusGlyph; window.statusLabel = statusLabel;

/* ── BCB baselines (BCB0 … BCB2) ──────────────────────────────────────────
   A project's budget is re-baselined over time, so the SAME work package can
   show savings against BCB0 and a loss against BCB1. Each baseline is stored in
   its own column (`budget_bcb0…2`); `approved_budget_bcb` holds the CURRENT
   one, which is what every chart/KPI/table/export already reads.
   Rather than thread a baseline argument through ~110 read sites, the switcher
   re-maps `approved_budget_bcb` on the loaded array (`applyBcbBaseline`) and the
   whole dashboard re-renders against it unchanged. */
const BCB_LEVELS = ['bcb0','bcb1','bcb2'];
const BCB_LABELS = { bcb0:'BCB0', bcb1:'BCB1', bcb2:'BCB2' };

// The figure explicitly recorded AT this baseline (BCB0 falls back to the single
// legacy budget column, so data imported before baselines existed still reads).
function bcbValue(w, level) {
  if (!w) return null;
  const v = w['budget_' + level];
  if (v != null) return v;
  return (level === 'bcb0') ? (w.approved_budget_bcb ?? null) : null;
}
// The budget IN FORCE at a baseline: that baseline's figure, else carry forward the
// newest earlier one — a WP whose budget didn't change at BCB2 still has its BCB1 value.
function bcbEffective(w, level) {
  const i = BCB_LEVELS.indexOf(level);
  if (i < 0) return w?.approved_budget_bcb ?? null;
  for (let j = i; j >= 0; j--) { const v = bcbValue(w, BCB_LEVELS[j]); if (v != null) return v; }
  return w?.approved_budget_bcb ?? null;
}
// Which baselines actually carry data — drives the switcher. A project may have NO BCB0:
// QHL706's monitoring sheet heads its budget "BUDGET 1 - BCB1 (VAT EX)", so every WP lands
// in budget_bcb1 and there is no original baseline to show. Offering an empty BCB0 tab
// there would display BCB1's own figures under a BCB0 label — so only populated levels
// are offered. Rows imported before baselines existed have none populated; BCB0 then
// stands for the single stored budget.
function bcbLevelsPresent(wps) {
  const out = {};
  BCB_LEVELS.forEach(l => { out[l] = (wps||[]).some(w => w['budget_'+l] != null); });
  if (!BCB_LEVELS.some(l => out[l])) out.bcb0 = true;
  return out;
}
// Lowest baseline that actually has data — the sensible default for this data set.
function bcbDefaultLevel(wps) {
  const p = bcbLevelsPresent(wps);
  return BCB_LEVELS.find(l => p[l]) || 'bcb0';
}
// Return a copy of the WP list with approved_budget_bcb set to the chosen baseline.
function applyBcbBaseline(wps, level) {
  if (!level || !BCB_LEVELS.includes(level)) return wps || [];
  return (wps||[]).map(w => {
    const v = bcbEffective(w, level);
    return (v === w.approved_budget_bcb) ? w : { ...w, approved_budget_bcb: v };
  });
}
// Selected baseline, persisted per user. Defaults to BCB0 (the original budget).
const BcbBaseline = (() => {
  const key = () => 'wpm_bcb_' + ((window.__profile && window.__profile.id) || 'anon');
  function get() {
    try { const v = localStorage.getItem(key()); if (v && BCB_LEVELS.includes(v)) return v; } catch (_) {}
    return 'bcb0';
  }
  function set(v) { try { if (BCB_LEVELS.includes(v)) localStorage.setItem(key(), v); } catch (_) {} }
  function label(v) { return BCB_LABELS[v || get()] || 'BCB0'; }
  // The level to actually render for THIS data: the user's pick if that baseline has
  // data here, otherwise the lowest one that does (never an empty baseline).
  function resolve(wps) {
    const p = bcbLevelsPresent(wps), pref = get();
    return p[pref] ? pref : bcbDefaultLevel(wps);
  }
  return { get, set, label, resolve, LEVELS: BCB_LEVELS, LABELS: BCB_LABELS };
})();
window.BCB_LEVELS = BCB_LEVELS; window.BCB_LABELS = BCB_LABELS;
window.bcbValue = bcbValue; window.bcbEffective = bcbEffective;
window.bcbLevelsPresent = bcbLevelsPresent; window.bcbDefaultLevel = bcbDefaultLevel;
window.applyBcbBaseline = applyBcbBaseline;
window.BcbBaseline = BcbBaseline;

/* ── Formatting ─────────────────────────────────────────────────────── */
// HTML-escape user-entered text before it goes into innerHTML. WP fields (description,
// remarks, vendor, wp_no…) and self-registered user name/email are attacker-controllable
// (a contributor can PATCH a WP, a pending registrant sets their own name) — without this,
// a payload like <img src=x onerror=…> stored in a field runs in an ADMIN's session when
// they open the list, exfiltrating the Supabase JWT from localStorage → account takeover.
// Escapes the 5 HTML-significant chars so the value is inert as text AND in a quoted attr.
// Returns '' for null/undefined so callers can keep `|| '—'` fallbacks.
window.esc = function (v) {
  return v == null ? '' : String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

/* ── Group Heads ────────────────────────────────────────────────────
   SINGLE SOURCE OF TRUTH for the Group Head roster. Stored per project in
   projects.group_head (migrations/2026-08-06_project_group_head.sql) as free text, so
   changing this list needs no DB migration — an existing project tagged with a
   name later removed from the roster still displays, and _ghOptions() below
   re-adds it as a "(legacy)" option so an edit doesn't silently clear it
   (same pattern as fillSelectLegacy() in wp-form.html).
   Consumers: the New Project modal (below), project.html's Edit Project modal,
   admin.html's New Project modal, and index.html's Portfolio Overview
   filter / group / sort controls. */
window.GROUP_HEADS = ['Tan','Rodrin','Ronquillo','Calimag','Fellowes','Flores'];
window.GH_UNASSIGNED = 'Unassigned';           // display label for a blank group_head
window.ghLabel = function (v) { return (v && String(v).trim()) || window.GH_UNASSIGNED; };
// <option> markup for a Group Head <select>. `cur` is pre-selected and, when it's
// an off-roster legacy value, prepended so editing can't drop it.
window.ghOptions = function (cur) {
  const c = (cur == null ? '' : String(cur).trim());
  const list = window.GROUP_HEADS.slice();
  if (c && !list.some(g => g.toLowerCase() === c.toLowerCase())) list.unshift(c);
  return `<option value=""${c ? '' : ' selected'}>— ${window.GH_UNASSIGNED} —</option>` +
    list.map(g => `<option value="${esc(g)}"${g.toLowerCase() === c.toLowerCase() ? ' selected' : ''}>${esc(g)}</option>`).join('');
};

const Fmt = {
  money(v, decimals=2) {
    if (v==null||isNaN(v)) return '\u2014';
    const a=Math.abs(v);
    // Auto-scale so billions read as B (\u20B11.50B) instead of an ambiguous \u20B11500.00M
    if (a>=1e9) return '\u20B1'+(a/1e9).toFixed(decimals)+'B';
    return '\u20B1'+(a/1e6).toFixed(decimals)+'M';
  },
  moneyFull(v) {
    if (v==null||isNaN(v)) return '\u2014';
    return '\u20B1'+Math.round(Math.abs(v)).toLocaleString('en-US');
  },
  // Compact headline figure: auto-scales to B / M, else full. Sign is dropped
  // (callers prepend +/-); pair with moneyFull(v) in a title for the exact value.
  moneyShort(v) {
    if (v==null||isNaN(v)) return '\u2014';
    const a=Math.abs(v);
    if (a>=1e9) return '\u20B1'+(a/1e9).toFixed(2)+'B';
    if (a>=1e6) return '\u20B1'+(a/1e6).toFixed(2)+'M';
    return '\u20B1'+Math.round(a).toLocaleString('en-US');
  },
  date(d) {
    if (!d) return '\u2014';
    try { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); }
    catch { return d; }
  }
};

const Calc = {
  variance(w) { return (w.approved_budget_bcb??0)-(w.total_awarded??0); }
};

/* ── CSV Export ─────────────────────────────────────────────────────── */
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

  // BOM + header + data — BOM ensures Excel opens UTF-8 correctly (handles ₱ etc)
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

/* ── KPI help — plain-English definitions shown as hover tooltips on metric labels ── */
window.KPI_HELP = {
  'Procurement Budget (BCB)':'Total approved procurement budget (Base Cost Budget, net) across these work packages.',
  'Actual Award':'Total awarded cost of the WPs already awarded — the sum of their contract amounts.',
  'Balance to Award':'Budget still to be committed = Total Budget − budget of the awarded WPs. The sub-line shows how many WPs remain.',
  'Savings / Loss':'Budget for the awarded WPs minus what they were actually awarded for. Green = savings, red = over budget.',
  'Procurement Cost to Complete':'Budget remaining to award = Total Budget − budget of the awarded WPs.',
  'Cost to Complete':'Budget remaining to award = Total Budget − budget of the awarded WPs.',
  'Procurement Estimate at Completion':'Projected total spend = awarded cost so far + budget of the not-yet-awarded WPs.',
  'Estimate at Completion':'Projected total spend = awarded cost so far + budget of the not-yet-awarded WPs.',
  'Variance':'Total Budget − Estimate at Completion. Positive = under budget, negative = over budget.'
};
// Returns the ` title="…" style="cursor:help"` attributes for a KPI label (empty if no help defined).
// KPI label help. A bare `title` is invisible on touch (no hover) and is never
// announced reliably, so the label also gets: an aria-label (screen readers),
// tabindex (keyboard reachable) and a `data-tip` the Tooltip helper in ui.js shows
// on tap/focus. The dotted underline signals that help exists at all.
window.kpiLabelAttrs = function(lbl){
  const h=(window.KPI_HELP||{})[lbl];
  if(!h) return '';
  const esc=String(h).replace(/"/g,'&quot;');
  return ' title="'+esc+'" data-tip="'+esc+'" tabindex="0" role="button"'
       + ' aria-label="'+String(lbl).replace(/"/g,'&quot;')+' — what is this? '+esc+'"'
       + ' class="has-tip"';
};

/* ── User bar — avatar only, role in dropdown ───────────────────────── */
function renderUserBar(id, profile) {
  const el = document.getElementById(id);
  if (!el || !profile) return;
  const initials = (profile.name||profile.email||'U').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const dark = typeof AppTheme !== 'undefined' && AppTheme.isDark(profile.id);
  // Export PDF / Export Excel move into this dropdown ON MOBILE ONLY (class hidden ≥768px in
  // dashboard.css) — the topbar hides those two buttons on mobile (too many icons crowded the
  // page title, see Known Issues), so this is the only way to reach them there. Detected by
  // presence in the DOM, so it works on whichever page loaded (project.html has both; index.html
  // has PDF only) with no per-page code. `.click()` on the real (hidden) button reuses its exact
  // handler — including its own `__hideBudget` viewer guard — so nothing needs duplicating.
  // Still gated here too so a viewer never sees a menu entry that would silently no-op.
  const exportItems = window.__hideBudget ? '' : ['btn-export-xlsx','btn-export'].map(bid => {
    if (!document.getElementById(bid)) return '';
    const label = bid === 'btn-export-xlsx' ? 'Export Excel' : 'Export PDF';
    const icon  = bid === 'btn-export-xlsx' ? 'ti-file-type-xls' : 'ti-file-type-pdf';
    return `<a class="user-menu-mobile-only" onclick="event.preventDefault();(function(){var m=document.getElementById('user-menu');if(m)m.style.display='none';var b=document.getElementById('${bid}');if(b)b.click();})()" style="
            display:flex;align-items:center;gap:8px;padding:12px 16px;
            font-size:0.9286rem;color:#231F20;font-weight:600;text-decoration:none;
            font-family:inherit;cursor:pointer;border-bottom:1px solid #f5f5f5;">
            <i class="ti ${icon}" style="font-size:1.1429rem;color:#888"></i>${label}
          </a>`;
  }).join('');
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px">
      <button id="theme-toggle-btn" class="theme-toggle"
        onclick="AppTheme.toggle('${profile.id}')"
        title="${dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}">
        <i class="ti ${dark ? 'ti-sun' : 'ti-moon-stars'}" style="font-size:1.2143rem;line-height:1"></i>
      </button>
      <div style="position:relative">
        <button id="avatar-btn" onclick="toggleUserMenu()" title="${esc(profile.name||profile.email)}" style="
          width:36px;height:36px;border-radius:50%;background:#EE3124;color:#fff;
          border:none;cursor:pointer;font-size:0.9286rem;font-weight:700;font-family:inherit;
          display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</button>
        <div id="user-menu" style="
          display:none;position:absolute;right:0;top:44px;
          background:#fff;border:1px solid #f0f0f0;border-radius:12px;
          box-shadow:0 8px 32px rgba(0,0,0,.12);width:220px;z-index:9999;overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid #f5f5f5;">
            <div style="font-size:0.9286rem;font-weight:600;color:#231F20">${esc(profile.name||profile.email)}</div>
            <div style="font-size:0.7857rem;color:#888;margin-top:2px;text-transform:capitalize">${(profile.role||'').replace(/_/g,' ')}</div>
          </div>
          ${exportItems}
          ${profile.role === 'super_admin' && typeof window.switchTab === 'function' ? `
          <a onclick="event.preventDefault();(function(){var m=document.getElementById('user-menu');if(m)m.style.display='none';window.switchTab('actions');})()" style="
            display:flex;align-items:center;gap:8px;padding:12px 16px;
            font-size:0.9286rem;color:#231F20;font-weight:600;text-decoration:none;
            font-family:inherit;cursor:pointer;border-bottom:1px solid #f5f5f5;">
            <i class="ti ti-alert-triangle" style="font-size:1.1429rem;color:#888"></i>Action Center
          </a>` : ''}
          ${typeof window.PatchNotice !== 'undefined' ? `
          <a onclick="event.preventDefault();(function(){var m=document.getElementById('user-menu');if(m)m.style.display='none';PatchNotice.open();})()" style="
            display:flex;align-items:center;gap:8px;padding:12px 16px;
            font-size:0.9286rem;color:#231F20;font-weight:600;text-decoration:none;
            font-family:inherit;cursor:pointer;border-bottom:1px solid #f5f5f5;">
            <i class="ti ti-sparkles" style="font-size:1.1429rem;color:#888"></i>What's New
          </a>` : ''}
          <a onclick="event.preventDefault();(function(){var m=document.getElementById('user-menu');if(m)m.style.display='none';if(window.CoachTour&&CoachTour.available()){CoachTour.start(true);}else if(window.Onboarding&&Onboarding.open){Onboarding.open();}else{window.location.href='onboarding.html';}})()" style="
            display:flex;align-items:center;gap:8px;padding:12px 16px;
            font-size:0.9286rem;color:#231F20;font-weight:600;text-decoration:none;
            font-family:inherit;cursor:pointer;border-bottom:1px solid #f5f5f5;">
            <i class="ti ti-route" style="font-size:1.1429rem;color:#888"></i>Restart tour
          </a>
          <a href="login.html" onclick="event.preventDefault();AppAuth.logout()" style="
            display:flex;align-items:center;gap:8px;padding:12px 16px;
            font-size:0.9286rem;color:#EE3124;font-weight:600;text-decoration:none;
            font-family:inherit;cursor:pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>Sign out
          </a>
        </div>
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

/* ── Metrics & Rank helpers ─────────────────────────────────────────── */
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
  if (!items.length) { el.innerHTML='<div style="color:#aaa;font-size:0.8571rem;padding:10px 0">No data</div>'; return; }

  if (!document.getElementById('_rankTblStyle')) {
    const s = document.createElement('style');
    s.id = '_rankTblStyle';
    s.textContent = [
      // All 5 rows always visible. The value columns (BCB/Award/…) keep their width (nowrap); the
      // WP-NAME column TRUNCATES with an ellipsis so long names can never push the value columns off
      // the card (the classic max-width:0 + overflow:hidden trick in a width:100% table). Full name
      // is in the cell's title tooltip and one click away in the detail panel. Mobile-safe: no scroll.
      '.rank-row{cursor:default}',
      // Full names on one line. In the default 3-up view a cramped card scrolls left↔right; to read
      // the whole table at a glance, click the card title to EXPAND the card to full width (accordion
      // in ui.js — initTop5Accordion).
      '.rank-table-scroll{overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch}',
      '.rank-table-scroll table{min-width:100%}',
      '.rank-short,.rank-sub{white-space:nowrap}',
    ].join('');
    document.head.appendChild(s);
  }

  const isValue  = type === 'value';
  const accent   = type === 'savings' ? '#2D9B6F' : '#EE3124';
  const valLabel = type === 'savings' ? 'Savings' : type === 'loss' ? 'Overbudget' : 'BCB';
  const valSign  = type === 'savings' ? '+' : type === 'loss' ? '-' : '';
  // Right-aligned headers use the SAME 8px horizontal padding as their value cells so they line up.
  const th = (txt, right, color) =>
    `<th style="font-size:0.5714rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${color||'#777'};padding:7px 8px 7px ${right?'8px':'0'};text-align:${right?'right':'left'};border-bottom:2px solid #ebebeb;white-space:nowrap">${txt}</th>`;
  const valueAccent = '#231F20';
  const thead = isValue
    ? `<tr>${th('#&nbsp;&nbsp;Work Package',false)} ${th(valLabel,true)} ${th('Award',true)} ${th('Savings/Loss',true,valueAccent)} ${th('%',true,valueAccent)} ${th('%WT',true,valueAccent)}</tr>`
    : `<tr>${th('#&nbsp;&nbsp;Work Package',false)} ${th('BCB',true)} ${th('Award',true)} ${th(valLabel,true,accent)} ${th('%',true,accent)} ${th('%WT',true,accent)}</tr>`;
  const rows = items.map((item, i) => {
    const safe = esc(item.name);  // data-rn attribute (used by search filter)
    // Clicking a row opens the WP detail slide-in panel (full details + Edit/Delete)
    const click = item.id ? ` onclick="if(window.openWPDetail)openWPDetail('${item.id}')"` : '';
    const cursor = item.id ? 'cursor:pointer;' : '';
    const wpCell = `<td style="padding:9px 8px 9px 0;vertical-align:top">
      <div style="display:flex;align-items:flex-start;gap:6px">
        <span style="font-size:0.7143rem;color:#999;font-weight:700;flex-shrink:0;min-width:14px;padding-top:1px">${i+1}</span>
        <div>
          <div class="rank-short" title="${esc(item.name)}" style="font-size:0.7857rem;font-weight:600;color:#231F20;line-height:1.35;white-space:nowrap">${esc(item.name)}</div>
          <div class="rank-sub" style="font-size:0.6429rem;color:#888;margin-top:1px;white-space:nowrap">${esc(item.sub)||''}</div>
        </div>
      </div>
    </td>`;
    // Buyback recovery is shown as a separate annotation next to Savings/%/%WT, not folded
    // into the main figure — matches the 2026-08-12 KPI change (item.savings/val/pct/wt above
    // are already computed against RAW awarded cost, excluding buyback).
    const bbNote = item.bb > 0.5
      ? ` <span style="font-size:0.6em;font-weight:600;color:#888;white-space:nowrap">(+${Fmt.money(item.bb)} BB)</span>` : '';
    if (isValue) {
      const rowColor = (item.savings!=null && item.savings<0) ? '#EE3124' : '#2D9B6F';
      const savingsTxt = item.savings!=null ? (item.savings>=0?'+':'-')+Fmt.money(Math.abs(item.savings)) : '—';
      return `<tr class="rank-row" data-rn="${safe}"${click} style="${cursor}border-bottom:1px solid #f5f5f5">${wpCell}
        <td class="rank-side" style="font-size:0.8571rem;font-weight:700;color:#231F20;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.val)}</td>
        <td class="rank-side" style="font-size:0.7143rem;color:#777;font-weight:500;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.awarded)}</td>
        <td class="rank-side" style="font-size:0.8571rem;font-weight:700;color:${rowColor};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap" title="Budget (BCB) − Awarded Cost, excluding buyback recovery">${savingsTxt}${bbNote}</td>
        <td class="rank-side" style="font-size:0.7857rem;font-weight:600;color:${rowColor};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap" title="Savings/Loss ÷ Budget (BCB)">${item.pct!=null?item.pct:'—'}</td>
        <td class="rank-side" style="font-size:0.7857rem;font-weight:600;color:${rowColor};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap" title="Savings/Loss ÷ Total BCB">${item.wt!=null?item.wt:'—'}</td>
      </tr>`;
    }
    return `<tr class="rank-row" data-rn="${safe}"${click} style="${cursor}border-bottom:1px solid #f5f5f5">${wpCell}
      <td class="rank-side" style="font-size:0.7143rem;color:#888;font-weight:500;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.bcb)}</td>
      <td class="rank-side" style="font-size:0.7143rem;color:#777;font-weight:500;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.awarded)}</td>
      <td class="rank-side" style="font-size:0.8571rem;font-weight:700;color:${accent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap" title="Excludes buyback recovery">${valSign}${Fmt.money(item.val)}${bbNote}</td>
      <td class="rank-side" style="font-size:0.7857rem;font-weight:600;color:${accent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${item.pct}</td>
      <td class="rank-side" style="font-size:0.7857rem;font-weight:600;color:${accent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap" title="Savings ÷ Total BCB">${item.wt!=null?item.wt:'—'}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="rank-table-scroll"><table style="width:100%;border-collapse:collapse;font-family:inherit"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>`;
}

function buildRankList(id, items, colorClass, fmtVal) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) { el.innerHTML='<div style="color:#aaa;font-size:0.8571rem;padding:8px 0">No data</div>'; return; }
  el.innerHTML = items.map((item,i) => {
    const hasBcbAwd = item.bcb!=null && item.awarded!=null;
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #f5f5f5">
      <span style="font-size:0.7857rem;color:#aaa;font-weight:600;width:16px;flex-shrink:0;padding-top:2px">${i+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.8571rem;font-weight:600;color:#231F20;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(item.name)}</div>
        <div style="font-size:0.7143rem;color:#999;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.sub}</div>
        ${hasBcbAwd?`<div style="font-size:0.7143rem;color:#bbb;margin-top:1px;white-space:nowrap">BCB ${Fmt.money(item.bcb)} <span style="color:#ddd">→</span> Awd ${Fmt.money(item.awarded)}</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0;padding-top:2px">
        <div style="font-size:0.9286rem;font-weight:700;color:${item.color};white-space:nowrap">${fmtVal(item.val)}</div>
        ${item.pct!=null?`<div style="font-size:0.7143rem;font-weight:600;color:${item.color};white-space:nowrap">${item.pct}</div>`:''}
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
  const awarded    = wps.filter(w=>window.isResolved(w)).length;
  const totalBCB   = wps.reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
  const totalAwd   = wps.reduce((s,w)=>s+(w.total_awarded||0),0);
  const variance   = totalBCB - totalAwd;
  const awardRate  = wps.length ? Math.round(awarded/wps.length*100) : 0;
  const fmtM = v => v != null ? (v>=0?'+':'-')+((Math.abs(v))/1e6).toFixed(2)+'M' : '-';
  const fmtV = v => v != null ? ((v)/1e6).toFixed(2)+'M' : '-';
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}) : '-';

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

/* ── Global New Project Modal (overridden by admin.html's own version) ── */
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
          <div style="font-size:1.1429rem;font-weight:700;color:#231F20;margin-bottom:4px">New Project</div>
          <div style="font-size:0.9286rem;color:#888;margin-bottom:16px">Create a new EPC project and assign users</div>
        </div>
        <div style="padding:0 20px 16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px">
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Project Code * <span style="font-size:0.6429rem;font-weight:400;text-transform:none">(letters/numbers only, e.g. AVR102)</span></div>
            <input id="gnp-id" type="text" placeholder="e.g. AVR102" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Project Name *</div>
            <input id="gnp-name" type="text" placeholder="e.g. Avesta Residences Tower 2"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Location</div>
            <input id="gnp-location" type="text" placeholder="e.g. Quezon City"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Group Head</div>
            <select id="gnp-group-head"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box;background:var(--surface,#fff)">${window.ghOptions('')}</select>
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Description</div>
            <input id="gnp-description" type="text" placeholder="Optional project description"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Assign Users (optional)</div>
            <div id="gnp-user-list"><div style="color:#aaa;font-size:0.8571rem">Loading…</div></div>
          </div>
          <div id="gnp-error" style="display:none;background:#FEE2E2;color:#991B1B;border-radius:8px;padding:10px 12px;font-size:0.9286rem"></div>
        </div>
        <div style="padding:12px 20px 20px;flex-shrink:0;border-top:1px solid #f0f0f0;display:flex;gap:10px">
          <button onclick="window._gnpConfirm()" id="gnp-create-btn"
            style="flex:1;padding:10px;background:#EE3124;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;font-family:inherit;cursor:pointer">
            <i class="ti ti-plus" style="font-size:1rem;margin-right:4px;vertical-align:middle"></i> Create Project
          </button>
          <button onclick="window._gnpClose()"
            style="padding:10px 16px;background:transparent;color:#666;border:1px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;cursor:pointer">Cancel</button>
        </div>
      </div>`;
    m.addEventListener('click', e => { if(e.target===m) window._gnpClose(); });
    document.body.appendChild(m);
    return m;
  }

  window._gnpClose = function() {
    const m = document.getElementById('gnp-global-modal');
    if (m) m.style.display = 'none';
    ['gnp-id','gnp-name','gnp-location','gnp-description','gnp-group-head'].forEach(id=>{
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
    const selectedUsers = [...document.querySelectorAll('#gnp-user-rows input:checked')].map(cb=>cb.value);
    const btn = document.getElementById('gnp-create-btn');
    btn.textContent='Creating…'; btn.disabled=true; errEl.style.display='none';
    try {
      // budget_bcb is intentionally omitted — a project's BCB is the sum of its work packages' BCB (computed)
      await WPDb.createProject({id, name, location:v('gnp-location'), description:v('gnp-description'), group_head:v('gnp-group-head')||null, status:'active'});
      for (const uid of selectedUsers) {
        const user = _gnpUsers.find(u=>u.id===uid);
        if (user) await WPDb.updateUser(uid, {projects:[...new Set([...(user.projects||[]),id])]});
      }
      window._gnpClose();
      const toast = document.createElement('div');
      toast.innerHTML=`<div style="position:fixed;bottom:24px;right:24px;background:#2D9B6F;color:#fff;padding:14px 20px;border-radius:12px;font-size:1rem;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:9999">✓ Project ${id} created</div>`;
      document.body.appendChild(toast); setTimeout(()=>toast.remove(),3000);
      if (typeof loadData==='function') setTimeout(loadData,500);
      if (typeof loadAll==='function') setTimeout(loadAll,500);
      if (typeof renderOverview==='function') setTimeout(renderOverview,600);
    } catch(err) {
      errEl.textContent=(err.message.includes('duplicate')||err.message.includes('unique'))
        ?`Project Code "${id}" already exists.`:'Error: '+err.message;
      errEl.style.display='block';
      const b=document.getElementById('gnp-create-btn'); b.innerHTML='<i class="ti ti-plus" style="font-size:1rem;margin-right:4px;vertical-align:middle"></i> Create Project'; b.disabled=false;
    }
  };

  window.openNewProjectModal = async function() {
    const modal = _gnpGetOrCreate();
    modal.style.display = 'flex';
    const list = document.getElementById('gnp-user-list');
    if (list) list.innerHTML = '<div style="color:#aaa;font-size:0.8571rem">Loading…</div>';
    try {
      _gnpUsers = await WPDb.getAllUsers();
      const approved = _gnpUsers.filter(u=>u.status==='approved');
      if (list) {
        list.innerHTML = `
          <div style="position:relative;margin-bottom:8px">
            <i class="ti ti-search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:#bbb;font-size:0.9286rem"></i>
            <input type="text" placeholder="Search users…" oninput="document.querySelectorAll('.gnpu-row').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')"
              style="width:100%;padding:6px 10px 6px 28px;border:1px solid #e5e5e5;border-radius:7px;font-size:0.8571rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div id="gnp-user-rows" style="display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto">
            ${approved.length?approved.map(u=>`
              <div class="gnpu-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e5e5e5;border-radius:8px;cursor:pointer" onclick="this.querySelector('input').click()">
                <input type="checkbox" value="${u.id}" onclick="event.stopPropagation()" style="width:16px;height:16px;accent-color:#EE3124;cursor:pointer">
                <label onclick="event.preventDefault()" style="cursor:pointer;font-size:0.9286rem;pointer-events:none">${esc(u.name||u.email)} <span style="font-size:0.7143rem;color:#aaa">(${(u.role||'user').replace(/_/g,' ')})</span></label>
              </div>`).join(''):'<div style="color:#aaa;font-size:0.8571rem">No approved users</div>'}
          </div>`;
      }
    } catch(e) {
      if (list) list.innerHTML = '<div style="color:#c00;font-size:0.8571rem">Could not load users.</div>';
    }
    document.getElementById('gnp-id')?.focus();
  };
})();

/* ──────────────────────────────────────────────────────────────────────────
   WPCsv — shared Work Package CSV import (used by wp-form.html & project.html)
   Header-name driven so the existing Work Package Monitoring layout imports
   directly. Falls back to position-based mapping for the native 54-col template
   and the legacy 25-col files. Handles quoted fields with embedded newlines
   (the cause of the "705 rows" bug) and Excel serial-number dates.
   ────────────────────────────────────────────────────────────────────────── */
window.WPCsv = (function(){
  'use strict';

  // RFC-4180-style tokenizer: respects quotes, "" escapes, and newlines inside quotes
  function parse(text){
    text = String(text || '').replace(/^﻿/, '');   // strip BOM
    const rows = []; let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++){
      const ch = text[i];
      if (inQ){
        if (ch === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\r') { /* swallow — \n closes the row */ }
        else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
        else cur += ch;
      }
    }
    if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
    // drop fully-blank rows (trailing newlines, spacer rows)
    return rows.filter(r => r.some(c => (c || '').trim() !== ''));
  }

  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // normalized-header → canonical field. Covers BOTH the WP-Monitoring adopted
  // layout and the native template. Generated columns (TOTAL, VARIANCE,
  // *LEAD TIME) are intentionally absent so they are skipped.
  const HMAP = {
    costcodeno:'cost_code', costcode:'cost_code',
    trade:'trade', tradediscipline:'trade',
    works:'works',
    typeofworks:'type_of_works',
    workpackageno:'wp_no', wpno:'wp_no', workpackagenumber:'wp_no',
    workpackagedescription:'description', workpackagedesc:'description',
    description:'detailed_description', detaileddescription:'detailed_description',
    detaileddescriptionscopeofwork:'detailed_description',
    scopeofwork:'scope', scope:'scope',
    zone:'zone',
    typeofservice:'type_of_service',
    typeofprocurement:'type_of_procurement',
    typeofcontract:'type_of_contract',
    chargingtype:'charging_type',
    contractpackageno:'contract_package_no',
    codescription:'co_description',
    proposedvendors:'proposed_vendors', proposedvendorssuppliers:'proposed_vendors',
    noofpojo:'po_jo_count',
    pojonos:'po_jo_numbers', pojonumbers:'po_jo_numbers',
    responsible:'responsible_team', responsibleteam:'responsible_team',
    approver:'approver',
    support:'support_team', supportteam:'support_team',
    surety:'surety_bond', suretybond:'surety_bond', suretybondyesno:'surety_bond',
    performance:'performance_bond', performancebond:'performance_bond', performancebondyesno:'performance_bond',
    warranty:'warranty_bond', warrantybond:'warranty_bond', warrantybondyesno:'warranty_bond',
    budgetbcbnet:'approved_budget_bcb', budgetbcb:'approved_budget_bcb',
    procurementbudgetbcbphp:'approved_budget_bcb', procurementbudgetbcb:'approved_budget_bcb',
    awardedcostnet:'awarded_cost', awardedcost:'awarded_cost',
    contractamountawardedphp:'awarded_cost', contractamountawarded:'awarded_cost', contractamount:'awarded_cost',
    additionals:'additionals',
    awarded:'award_status', awardstatus:'award_status',
    vendorcontractor:'contractor', contractor:'contractor', vendors:'contractor', vendor:'contractor',
    termsdays:'payment_terms_days', terms:'payment_terms_days', paymentterms:'payment_terms_days', paymenttermsdays:'payment_terms_days',
    ofdp:'dp_percent', dp:'dp_percent', downpayment:'dp_percent', downpaymentpct:'dp_percent', dppercent:'dp_percent',
    dpterms:'dp_terms',
    notes:'dp_notes', paymentnotes:'dp_notes',
    dateofrelease:'dp_release_date', dateofdprelease:'dp_release_date',
    dpamount:'dp_amount', dpamountphp:'dp_amount',
    retention:'retention_percent', retentionpct:'retention_percent', retentionpercent:'retention_percent',
    retentionamount:'retention_amount', retentionamountphp:'retention_amount',
    retentionperiod:'retention_period',
    reqdapproval:'requires_approval', requiressubmittalapproval:'requires_approval', requiresapproval:'requires_approval',
    reqdapprovalyesno:'requires_approval', requiressubmittalapprovalyesno:'requires_approval',
    nameofapprover:'approver_name', submittalsapprovername:'approver_name',
    dateofapproval:'approval_date',
    typeofsubmittal:'submittal_type', submittalstatus:'submittal_type',
    submittaldocumenttype:'submittal_document_type',
    leadtimedays:'lead_time', leadtime:'lead_time',
    awardingdate:'awarding_date', plannedawarddate:'awarding_date',
    actualawardingdate:'actual_awarding_date', actualawarddate:'actual_awarding_date',
    targetdeliverydate:'target_delivery', targetdelivery:'target_delivery',
    actualdeliverydate:'actual_delivery',
    targetinstndate:'target_installation', targetinstallationdate:'target_installation',
    targetcompndate:'target_completion', targetcompletiondate:'target_completion',
    remarks:'remarks',
    awardingstatus:'awarding_status',
    deliverystatus:'delivery_status',
    purchaserequest:'purchase_request',
    procurementstatus:'procurement_status',
  };

  // Procurement-status stage columns (WP Monitoring). The right-most marked stage wins.
  // Mapped to the Procurement Status option set (Not Started | Sourced | Solicited |
  // Evaluated | Awarded) so re-imports stay aligned with the WP form.
  const STAGES = [
    ['sourcing','Sourced'], ['rfq','Solicited'], ['bidopen','Solicited'],
    ['bidclosed','Evaluated'], ['loa','Awarded'], ['contract','Awarded'], ['mobdel','Awarded'],
  ];

  function buildIdx(header){
    const idx = {}, stageIdx = {};
    (header || []).forEach((h, i) => {
      const n = norm(h);
      if (HMAP[n] !== undefined && idx[HMAP[n]] === undefined) idx[HMAP[n]] = i;
      const st = STAGES.find(s => s[0] === n);
      if (st && stageIdx[st[0]] === undefined) stageIdx[st[0]] = i;
    });
    return { idx, stageIdx };
  }

  // ── value parsers ──
  const pStr  = v => { v = (v == null ? '' : String(v)).trim(); return v === '' ? null : v; };
  const pNum  = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/[,\s₱]/g, '')); return isNaN(n) ? null : n; };
  const pInt  = v => { const n = parseInt(String(v == null ? '' : v).replace(/[,\s]/g, ''), 10); return isNaN(n) ? null : n; };
  const pPct  = v => { const n = pNum(v); if (n == null || n === 0) return null; return n > 1 ? n / 100 : n; };
  const pBond = v => { v = (v || '').trim().toLowerCase(); if (['yes','true','y','1'].includes(v)) return 'Yes'; if (['no','false','n','0',''].includes(v)) return 'No'; return v; };
  const pBool = v => ['yes','true','y','x','1'].includes((v || '').trim().toLowerCase());
  // Partial awards are not a valid state — "partially awarded" text maps to Not Yet Awarded (not fully awarded).
  function pAward(v){ v = (v || '').trim().toLowerCase(); if (!v) return null; if (v.includes('partial')) return 'Not Yet Awarded'; if (v.includes('not')) return 'Not Yet Awarded'; if (v.includes('award')) return 'Awarded'; return null; }
  function pDate(v){
    v = (v == null ? '' : String(v)).trim();
    if (!v || /^(n\/a|na|tbd|-|—)$/i.test(v)) return null;
    if (/^\d+(\.\d+)?$/.test(v)) {                       // bare number → Excel serial date
      const s = parseFloat(v);
      if (s > 20000 && s < 80000) { const d = new Date(Date.UTC(1899,11,30) + s * 86400000); return isNaN(d) ? null : d.toISOString().split('T')[0]; }
    }
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  const stageOn = v => { v = (v || '').trim().toLowerCase(); return !(['', 'false', 'no', '0', 'n/a', 'na', '-'].includes(v)); };

  function deriveProc(row, stageIdx){
    let last = null;
    for (const [k, label] of STAGES) if (stageIdx[k] !== undefined && stageOn(row[stageIdx[k]])) last = label;
    return last;
  }

  // Position-based fallback: native 54-col template, or legacy <40-col files
  function positionMap(r, pid){
    const is54 = r.length >= 40;
    if (is54) return {
      project_id:pid,
      cost_code:pStr(r[0]), trade:pStr(r[1]), works:pStr(r[2]), type_of_works:pStr(r[3]),
      wp_no:pStr(r[4]), description:pStr(r[5])||pStr(r[4]), detailed_description:pStr(r[6]), scope:pStr(r[7]),
      zone:pStr(r[8]), type_of_service:pStr(r[9]), type_of_procurement:pStr(r[10]),
      type_of_contract:pStr(r[11]), charging_type:pStr(r[12]),
      contract_package_no:pStr(r[13]), co_description:pStr(r[14]),
      proposed_vendors:pStr(r[15]), po_jo_count:pInt(r[16]), po_jo_numbers:pStr(r[17]),
      responsible_team:pStr(r[18]), approver:pStr(r[19]), support_team:pStr(r[20]),
      surety_bond:pBond(r[21]), performance_bond:pBond(r[22]), warranty_bond:pBond(r[23]),
      requires_approval:pBool(r[24]), submittal_document_type:pStr(r[25]), approver_name:pStr(r[26]),
      approval_date:pDate(r[27]), submittal_type:pStr(r[28])||'Not Required',
      lead_time:pInt(r[29]), awarding_date:pDate(r[30]), actual_awarding_date:pDate(r[31]),
      target_delivery:pDate(r[32]), actual_delivery:pDate(r[33]), target_installation:pDate(r[34]),
      target_completion:pDate(r[35]),
      approved_budget_bcb:pNum(r[36])||0, awarded_cost:pNum(r[37]),
      award_status:pStr(r[38])||'Not Yet Awarded', contractor:pStr(r[39]),
      payment_terms_days:pInt(r[40]), dp_percent:pPct(r[41]), dp_terms:pStr(r[42]),
      dp_amount:pNum(r[43]), dp_release_date:pDate(r[44]), dp_notes:pStr(r[45]),
      retention_percent:pPct(r[46]), retention_amount:pNum(r[47]), retention_period:pStr(r[48]),
      procurement_status:pStr(r[49])||'Not Started', awarding_status:pStr(r[50]),
      delivery_status:pStr(r[51])||'', remarks:pStr(r[52])||'', purchase_request:pStr(r[53]),
    };
    return {
      project_id:pid,
      cost_code:pStr(r[0]), trade:pStr(r[1]), works:pStr(r[2]),
      wp_no:pStr(r[3]), description:pStr(r[4])||pStr(r[3]), zone:pStr(r[5]), scope:pStr(r[6]),
      charging_type:pStr(r[7]), contract_package_no:pStr(r[8]), co_description:pStr(r[9]),
      proposed_vendors:pStr(r[10]), po_jo_count:pInt(r[11]), po_jo_numbers:pStr(r[12]),
      approved_budget_bcb:pNum(r[13])||0, awarded_cost:pNum(r[14]),
      award_status:pStr(r[15])||'Not Yet Awarded', procurement_status:pStr(r[16])||'Not Started',
      awarding_date:pDate(r[17]), actual_awarding_date:pDate(r[18]),
      target_delivery:pDate(r[19]), actual_delivery:pDate(r[20]),
      target_completion:pDate(r[21]), target_installation:pDate(r[22]),
      lead_time:pInt(r[23]), remarks:pStr(r[24])||'',
    };
  }

  // Returns true when the header row contains recognizable WP column names
  function isHeaderMode(table){ return buildIdx(table[0]).idx.wp_no !== undefined; }

  function dataRowCount(table){
    if (!table || table.length < 2) return 0;
    const { idx } = buildIdx(table[0]);
    const header = idx.wp_no !== undefined;
    let n = 0;
    for (let i = 1; i < table.length; i++){
      const r = table[i];
      const cell = header ? r[idx.wp_no] : r[r.length >= 40 ? 4 : 3];
      if ((cell || '').trim() !== '') n++;
    }
    return n;
  }

  function toWPData(table, pid){
    const { idx, stageIdx } = buildIdx(table[0]);
    const header = idx.wp_no !== undefined;
    const out = [];
    for (let i = 1; i < table.length; i++){
      const r = table[i];
      if (!header){
        const wp = positionMap(r, pid);
        if (wp.wp_no) out.push(wp);
        continue;
      }
      const g = f => idx[f] !== undefined ? r[idx[f]] : '';
      const wpno = pStr(g('wp_no'));
      if (!wpno) continue;
      const proc = pStr(g('procurement_status')) || deriveProc(r, stageIdx) || 'Not Started';
      const awardedCost = pNum(g('awarded_cost'));
      // Award status comes from the explicit AWARDED / REMARKS text (the WP-Monitoring
      // "Not yet Awarded / Awarded" in Column P). The procurement stage is NOT a reliable
      // award signal, so it is only used as a last resort via awarded_cost.
      let award_status = pAward(g('award_status'))
        || pAward(g('remarks'))
        || (awardedCost > 0 ? 'Awarded' : 'Not Yet Awarded');
      // Reconcile the one-way invariant (proc 'Awarded' ⇄ award 'Awarded') that the WP form and
      // Status Tracker enforce, so imported rows don't land with proc/award disagreeing — the
      // dashboards read award_status, and a mismatch would make the KPIs and the form disagree.
      let procurement_status = proc;
      if (procurement_status === 'Awarded') award_status = 'Awarded';
      else if (award_status === 'Awarded') procurement_status = 'Awarded';
      out.push({
        project_id:pid,
        cost_code:pStr(g('cost_code')), trade:pStr(g('trade')), works:pStr(g('works')),
        type_of_works:pStr(g('type_of_works')), wp_no:wpno,
        description:pStr(g('description')) || wpno, detailed_description:pStr(g('detailed_description')),
        scope:pStr(g('scope')), zone:pStr(g('zone')),
        type_of_service:pStr(g('type_of_service')), type_of_procurement:pStr(g('type_of_procurement')),
        type_of_contract:pStr(g('type_of_contract')), charging_type:pStr(g('charging_type')),
        contract_package_no:pStr(g('contract_package_no')), co_description:pStr(g('co_description')),
        proposed_vendors:pStr(g('proposed_vendors')), po_jo_count:pInt(g('po_jo_count')), po_jo_numbers:pStr(g('po_jo_numbers')),
        responsible_team:pStr(g('responsible_team')), approver:pStr(g('approver')), support_team:pStr(g('support_team')),
        surety_bond:pBond(g('surety_bond')), performance_bond:pBond(g('performance_bond')), warranty_bond:pBond(g('warranty_bond')),
        requires_approval:pBool(g('requires_approval')),
        submittal_document_type:pStr(g('submittal_document_type')), approver_name:pStr(g('approver_name')),
        approval_date:pDate(g('approval_date')), submittal_type:pStr(g('submittal_type')) || 'Not Required',
        lead_time:pInt(g('lead_time')), awarding_date:pDate(g('awarding_date')),
        actual_awarding_date:pDate(g('actual_awarding_date')), target_delivery:pDate(g('target_delivery')),
        actual_delivery:pDate(g('actual_delivery')), target_installation:pDate(g('target_installation')),
        target_completion:pDate(g('target_completion')),
        approved_budget_bcb:pNum(g('approved_budget_bcb')) || 0, awarded_cost:awardedCost,
        additionals:pNum(g('additionals')),
        award_status, contractor:pStr(g('contractor')),
        payment_terms_days:pInt(g('payment_terms_days')), dp_percent:pPct(g('dp_percent')),
        dp_terms:pStr(g('dp_terms')), dp_amount:pNum(g('dp_amount')), dp_release_date:pDate(g('dp_release_date')),
        dp_notes:pStr(g('dp_notes')), retention_percent:pPct(g('retention_percent')),
        retention_amount:pNum(g('retention_amount')), retention_period:pStr(g('retention_period')),
        procurement_status, awarding_status:pStr(g('awarding_status')),
        delivery_status:pStr(g('delivery_status')) || '', remarks:pStr(g('remarks')) || '',
        purchase_request:pStr(g('purchase_request')),
      });
    }
    return out;
  }

  return { parse, dataRowCount, toWPData, isHeaderMode };
})();

/* ── VendorDb (Phase 2a — Vendor Management) ─────────────────────────
   Directory + self-service portal. Staff creates a vendor skeleton
   (name + invite_email) → vendor claims it via vendor-register.html →
   edits their own contact/products/certs/personnel via vendor-portal.html
   (any post-approval edit is forced back to 'pending_review' server-side
   by the vendor_edit_guard trigger — see migrations/2026-08-10_vendor_management.sql).
   vendor_rates is staff-only. Phase 2b adds work_packages.vendor_id +
   vendor_bids on top of this — not present yet. */
/* ── Canonical trade normalizer (shared) ────────────────────────────
   Vendor trade_categories were seeded from RAW work-package trade strings
   (importVendorsFromWPs / backfillVendorDataFromWPs), which are only
   normalized at DISPLAY time on the WP dashboards (index/project inline
   normTrade), never in the DB. That let casing/label variants pile up on
   vendors — "GENERAL REQUIREMENT" vs "General Requirements", "ARCHITECTURAL
   WORKS" vs "Architectural works". This mirrors that inline normTrade
   (keep in sync with index.html/project.html/import-monitoring.html) so the
   vendor write paths + vendors.html can collapse them to the 10 canonical
   trades. `window.CanonTrades(arr)` maps + de-dups (case-insensitively) +
   preserves first-seen order. */
const _CANON_TRADE_MAP = {
  'general requirement':'General Requirements','general requirements':'General Requirements',
  'housekeeping & sanitation services':'General Requirements','housekeeping and sanitation services':'General Requirements',
  'drawing services':'General Requirements','security services':'General Requirements',
  'site works':'Site Works',
  'site development':'Site Development Works','site development works':'Site Development Works',
  'structural works':'Structural Works','structural labor and services':'Structural Works',
  'architectural works':'Architectural Works','aluminum and glazing works':'Architectural Works',
  'masonry works':'Architectural Works','drywall & ceiling works':'Architectural Works',
  'drywall and ceiling works':'Architectural Works','tiling works':'Architectural Works',
  'painting works':'Architectural Works','stoneworks':'Architectural Works','metal works':'Architectural Works',
  'mechanical works':'Mechanical Works',
  'electrical works':'Electrical and Auxiliary Works','auxiliary works':'Electrical and Auxiliary Works',
  'electrical and auxiliary works':'Electrical and Auxiliary Works','electrical & auxiliary works':'Electrical and Auxiliary Works',
  'plumbing works':'Plumbing Works','fire protection works':'Fire Protection Works',
  'allied services':'Allied Services','other allied services':'Allied Services',
};
function CanonTrade(t){
  if(!t) return t;
  const k=String(t).trim().toLowerCase();
  if(_CANON_TRADE_MAP[k]) return _CANON_TRADE_MAP[k];
  if(/landscap|amenit/.test(k)) return 'Architectural Works';
  if(/electr/.test(k)) return 'Electrical and Auxiliary Works';
  if(/auxiliary/.test(k)) return 'Electrical and Auxiliary Works';
  if(/fire/.test(k)) return 'Fire Protection Works';
  if(/plumb/.test(k)) return 'Plumbing Works';
  if(/mechanic|hvac|elevator|\blift\b|escalator/.test(k)) return 'Mechanical Works';
  if(/structural/.test(k)) return 'Structural Works';
  if(/site develop/.test(k)) return 'Site Development Works';
  if(/masonry|tiling|tile|drywall|ceiling|glazing|aluminum|aluminium|paint|stone|metal|finish|architectural/.test(k)) return 'Architectural Works';
  if(/general requirement|services$/.test(k)) return 'General Requirements';
  if(/\bsite\b/.test(k)) return 'Site Works';
  return String(t).trim();
}
function CanonTrades(arr){
  const out=[], seen=new Set();
  (arr||[]).forEach(t=>{ const c=CanonTrade(t); if(c && !seen.has(c.toLowerCase())){ seen.add(c.toLowerCase()); out.push(c); } });
  return out;
}
if (typeof window !== 'undefined') { window.CanonTrade = CanonTrade; window.CanonTrades = CanonTrades; }

/* ── Vendor accreditation (shared roster + helpers) ──────────────────
   `vendors.accreditation` (migrations/2026-08-19_vendor_accreditation.sql) is a plain
   text column, NOT an enum — the roster lives HERE, in one place, so the
   vocabulary can change with no DB migration (same reasoning as
   window.GROUP_HEADS). NULL/blank = "Not Accredited" (the ACCRED_NONE
   sentinel) — the single not-accredited state; see the roster below.

   ACCREDITATION IS THE ONLY VENDOR STANDING THE APP SHOWS. The older
   vendors.status review workflow (pending_review/approved/rejected/inactive)
   was retired from the UI in 2026-08 — every staff-created vendor is written
   as 'approved' and nothing reads the column back. It still EXISTS because
   RLS, the invite-claim flow and internal.vendor_edit_guard key off it (a
   vendor editing their OWN row is still forced back to 'pending_review'
   server-side); it is simply not a concept officers see or set any more.

   Use accredLabel()/accredMeta() rather than re-inlining a `|| 'Not Assessed'`
   fallback or a colour map, or the filter/group/KPI keys stop matching. */
/* TWO standings, not three (2026-08-20). "Unaccredited" and "Not Assessed"
   were two names for the same fact — the company is not on the accredited
   list — and having both meant a vendor could sit in either bucket for no
   reason anyone could explain. There is now ONE not-accredited state, and it
   is the ABSENCE of a value (NULL), so it cannot drift: a legacy stored
   'unaccredited' folds onto it in accredKey() rather than needing a data
   migration, and every write path sends NULL rather than the word. */
const ACCREDITATIONS = ['accredited', 'problematic'];
const ACCRED_NONE = 'none';   // filter/group key for a blank accreditation
const _ACCRED_META = {
  accredited:   { label: 'Accredited',     color: '#065F46', bg: '#D1FAE5', darkColor: '#6EE7B7', darkBg: '#102B1F', icon: 'ti-rosette-discount-check' },
  problematic:  { label: 'Problematic',    color: '#991B1B', bg: '#FEE2E2', darkColor: '#FCA5A5', darkBg: '#3D1A19', icon: 'ti-alert-triangle' },
  none:         { label: 'Not Accredited', color: '#6B6A6A', bg: '#F3F4F6', darkColor: 'var(--text-hint)', darkBg: 'var(--surface-2)', icon: 'ti-circle-dashed' },
};
// Normalize a stored value to a roster key (case/space tolerant). Legacy
// 'unaccredited' (and its spellings) folds onto the single not-accredited
// state; any other off-roster value is returned as-is so it still displays
// instead of blanking.
const _UNACCRED_RE = /^(un|non|not)\s*-?\s*accredited?$/;
function accredKey(v) {
  const k = String(v == null ? '' : v).trim().toLowerCase();
  if (!k || _UNACCRED_RE.test(k)) return ACCRED_NONE;
  return k;
}
function accredMeta(v) { return _ACCRED_META[accredKey(v)] || { ..._ACCRED_META.none, label: String(v) }; }
function accredLabel(v) { return accredMeta(v).label; }
/* Map free text from a masterdata sheet ("BLACKLISTED", "For Accreditation",
   "Accredited - 2023") onto a roster key; returns null when nothing matches, so
   an unrecognized cell is reported rather than silently guessed. Order matters:
   the negative/problematic patterns are tested BEFORE the positive ones so
   "NOT ACCREDITED" can't match the /accredited/ rule. */
function accredFromText(s) {
  const t = String(s == null ? '' : s).trim().toLowerCase();
  if (!t) return null;
  if (/black\s*-?\s*list|blacklist|banned|barred|disqualif|derogat|negative|problem|on\s*hold|\bhold\b|suspend|terminat|litigat|do\s*not\s*(use|engage)|\bdnu\b|delist/.test(t)) return 'problematic';
  if (/\bnot\s*accredit|non\s*-?\s*accredit|un\s*-?\s*accredit|de\s*-?\s*accredit|for\s*accredit|under\s*accredit|pending\s*accredit|no\s*accredit|expire|lapse|not\s*yet/.test(t)) return ACCRED_NONE;
  if (/accredit|approved|qualified|passed|active|compliant|\bok\b|\byes\b/.test(t)) return 'accredited';
  if (/^(no|none|n\/a|na)$/.test(t)) return ACCRED_NONE;
  return null;
}
/* ── Accreditation validity / renewal ───────────────────────────────────────
   An accreditation is not forever. ACCRED_VALID_MONTHS is the house policy for
   how long one stands before it must be renewed; accreditation_date is when it
   was granted. Changing that constant re-dates every vendor at once, which is
   why it lives here and not inlined at a call site.

   Only an ACCREDITED vendor can expire — a problematic or not-accredited one
   has nothing to lapse. A vendor with no accreditation_date on file is
   'unknown': we cannot claim it is current, and we must not claim it is
   expired either, so it is reported separately rather than folded into either.

   accredStanding(v) -> { key, state, days, date }
     state: 'ok' | 'due' | 'expired' | 'unknown' | 'n/a'
     days : days until expiry (negative = overdue), null when not computable. */
const ACCRED_VALID_MONTHS = 12;
const ACCRED_DUE_DAYS = 60;          // warn this far ahead of expiry
function _accredDate(v) {
  const raw = v && v.accreditation_date;
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  // Build from LOCAL parts — new Date('2026-06-30') is UTC midnight, which is
  // the previous day in UTC+8 (the sCurve bug).
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(raw);
  return isNaN(d) ? null : d;
}
function accredStanding(v) {
  const key = accredKey(v && v.accreditation);
  if (key !== 'accredited') return { key, state: 'n/a', days: null, date: null };
  const d = _accredDate(v);
  if (!d) return { key, state: 'unknown', days: null, date: null };
  const exp = new Date(d.getFullYear(), d.getMonth() + ACCRED_VALID_MONTHS, d.getDate());
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((exp - today) / 864e5);
  return { key, state: days < 0 ? 'expired' : days <= ACCRED_DUE_DAYS ? 'due' : 'ok', days, date: exp };
}
const _ACCRED_STATE_META = {
  ok:      { label: 'Current',        color: '#065F46' },
  due:     { label: 'Renewal due',    color: '#B45309' },
  expired: { label: 'Expired',        color: '#991B1B' },
  unknown: { label: 'No date on file', color: '#6B6A6A' },
  'n/a':   { label: '',               color: '#6B6A6A' },
};
function accredStandingMeta(state) { return _ACCRED_STATE_META[state] || _ACCRED_STATE_META['n/a']; }

if (typeof window !== 'undefined') {
  window.ACCREDITATIONS = ACCREDITATIONS;
  window.ACCRED_NONE = ACCRED_NONE;
  window.accredKey = accredKey;
  window.accredMeta = accredMeta;
  window.accredLabel = accredLabel;
  window.accredFromText = accredFromText;
  window.ACCRED_VALID_MONTHS = ACCRED_VALID_MONTHS;
  window.ACCRED_DUE_DAYS = ACCRED_DUE_DAYS;
  window.accredStanding = accredStanding;
  window.accredStandingMeta = accredStandingMeta;
}

/* ── Accreditation readiness ────────────────────────────────────────────────
   The checklist below is the procurement team's OWN accreditation
   requirement list, taken verbatim from the "KC Steps" sheet of the
   EPC. PROC. Vendor Masterdata workbook:

     Required documents:   BIR 2303 · Company Profile & Business Permits ·
                           Scanned copy of an invoice
     Required information: Terms of Payment · Contact Person · Position ·
                           Contact Number · Email Address

   TIN and address are included too — the masterdata/SAP encoding step that
   follows accreditation cannot be done without them.

   ONE definition, shared by the vendor portal (which shows the vendor what
   is still missing and gates the Request button) and the staff detail modal
   (which shows the reviewer the same list). Keep it here, not duplicated in
   either page, or the two will disagree about whether a vendor is ready. */
const ACCRED_DOC_TYPES = [
  { key: 'bir_2303',        label: 'BIR 2303 (Certificate of Registration)', required: true },
  { key: 'company_profile', label: 'Company Profile',                        required: true },
  { key: 'business_permit', label: 'Business Permit',                        required: true },
  { key: 'sample_invoice',  label: 'Scanned copy of an Invoice',             required: true },
  { key: 'other',           label: 'Other supporting document',              required: false },
];
function accredDocLabel(k) {
  const d = ACCRED_DOC_TYPES.find(x => x.key === k);
  return d ? d.label : (k || 'Document');
}
function accredReadiness(vendor, docs) {
  const v = vendor || {};
  const have = new Set((docs || []).filter(d => d && d.file_path).map(d => d.doc_type));
  const txt = k => !!(v[k] && String(v[k]).trim());
  const items = [
    { key: 'name',             label: 'Company name',        ok: txt('name'),            group: 'info' },
    { key: 'tin',              label: 'TIN',                 ok: txt('tin'),             group: 'info' },
    { key: 'address',          label: 'Address',             ok: txt('address'),         group: 'info' },
    { key: 'contact_person',   label: 'Contact person',      ok: txt('contact_person'),  group: 'info' },
    { key: 'contact_position', label: 'Position',            ok: txt('contact_position'),group: 'info' },
    { key: 'contact_number',   label: 'Contact number',      ok: txt('contact_number'),  group: 'info' },
    { key: 'contact_email',    label: 'Email address',       ok: txt('contact_email'),   group: 'info' },
    { key: 'payment_terms',    label: 'Terms of payment',    ok: txt('payment_terms'),   group: 'info' },
    { key: 'trade_categories', label: 'Trade categories',    ok: (v.trade_categories || []).length > 0, group: 'info' },
  ].concat(ACCRED_DOC_TYPES.filter(d => d.required).map(d => (
    { key: d.key, label: d.label, ok: have.has(d.key), group: 'docs' }
  )));
  const done = items.filter(i => i.ok).length;
  return { items, done, total: items.length, pct: Math.round(done / items.length * 100), missing: items.filter(i => !i.ok).map(i => i.label) };
}
if (typeof window !== 'undefined') {
  window.ACCRED_DOC_TYPES = ACCRED_DOC_TYPES;
  window.accredDocLabel = accredDocLabel;
  window.accredReadiness = accredReadiness;
}

const VendorDb = (() => {
  function _stamp() {
    const p = (typeof window !== 'undefined' && window.__profile) || {};
    return { updated_at: new Date().toISOString(), updated_by: p.id || null, updated_by_name: p.name || p.email || null };
  }
  function _isMissingCol(error, re) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return (error.code === '42703' || /column|does not exist|schema cache/i.test(m)) && re.test(m);
  }
  // Page past PostgREST's 1000-row default (own copy — VendorDb is a separate
  // closure from WPDb where the twin lives). makeQuery MUST return a FRESH builder.
  async function _pagedSelect(makeQuery) {
    const PAGE = 1000; let all = [], from = 0;
    for (;;) {
      const { data, error } = await makeQuery().range(from, from + PAGE - 1);
      if (error) throw error;
      const batch = data || [];
      all = all.concat(batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  /* Which relation a READ of a vendor row goes through — the twin of WPDb's
     _wpRel(). A `vendor` login is denied SELECT on `vendors` itself
     (migrations/2026-08-20_vendor_self_view.sql) because RLS cannot hide COLUMNS, so their
     reads go through vendor_self_view, which omits the staff-only ones. The
     probe is memoized and falls back to the base table if the view isn't
     deployed yet, so this is safe to ship before the migration runs. */
  let _vendorRelCache = null;
  async function _vendorRel() {
    if (typeof window === 'undefined' || window.__wpmRole !== 'vendor') return 'vendors';
    if (_vendorRelCache) return _vendorRelCache;
    try {
      const sb = await getSB();
      const { error } = await sb.from('vendor_self_view').select('id').limit(1);
      _vendorRelCache = error ? 'vendors' : 'vendor_self_view';
      if (error) console.warn('[VendorDb] vendor_self_view unavailable, falling back to vendors:', error.message);
    } catch (_) { _vendorRelCache = 'vendors'; }
    return _vendorRelCache;
  }

  // ── Vendors ────────────────────────────────────────────────────────
  async function getVendors() {
    const sb = await getSB();
    // paginate — the directory can exceed PostgREST's 1000-row default
    return _pagedSelect(() => sb.from('vendors').select('*').order('name'));
  }
  async function getVendor(id) {
    const sb = await getSB();
    const { data, error } = await sb.from(await _vendorRel()).select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  }
  async function createVendor(fields, profile) {
    const sb = await getSB();
    const payload = { ...fields, status: 'approved', created_by: profile?.id || null, ...(_stamp()) };
    let { data, error } = await sb.from('vendors').insert(payload).select().single();
    if (error && _isMissingCol(error, /created_by|updated_by|updated_by_name|updated_at/)) {
      const d2 = { ...payload }; delete d2.created_by; delete d2.updated_by; delete d2.updated_by_name; delete d2.updated_at;
      ({ data, error } = await sb.from('vendors').insert(d2).select().single());
    }
    if (error && _isMissingCol(error, /vendor_code/)) {
      const d3 = { ...payload }; delete d3.vendor_code;
      ({ data, error } = await sb.from('vendors').insert(d3).select().single());
    }
    if (error && _isMissingCol(error, /accreditation/)) {
      const d4 = _stripAccred(payload, error);
      ({ data, error } = await sb.from('vendors').insert(d4).select().single());
    }
    if (error && _isMissingCol(error, _PROFILE_RE)) {
      const d5 = _stripProfile(payload, error);
      ({ data, error } = await sb.from('vendors').insert(d5).select().single());
    }
    if (error) throw error;
    return data;
  }
  // Deploy-safe strip for migrations/2026-08-19_vendor_accreditation.sql. Strips PRECISELY
  // the column the error names (falling back to all three only when the base
  // `accreditation` column itself is missing) — a coarse strip-them-all guard
  // silently discarded a column the DB really did have when only the newest
  // sibling was absent (the _stripBuyback lesson, Known Issues #28b).
  function _stripAccred(payload, error) {
    const m = (error && ((error.message || '') + (error.details || ''))) || '';
    const out = { ...payload };
    const cols = /accreditation_notes/.test(m) ? ['accreditation_notes']
      : /accreditation_date/.test(m) ? ['accreditation_date']
      : ['accreditation', 'accreditation_notes', 'accreditation_date'];
    cols.forEach(c => delete out[c]);
    console.warn('[VendorDb] Dropped ' + cols.join(', ') + ' — NOT saved. If migrations/2026-08-19_vendor_accreditation.sql has already run, this guard is wrong, not the schema. Postgres said: ' + m);
    return out;
  }
  /* Deploy-safe strip for migrations/2026-08-20_vendor_accreditation_requests.sql's extra
     vendor profile columns (tin / contact_position / telephone / city /
     website / payment_terms / vendor_category / vendor_group). Strips
     PRECISELY the column the error names — same precision rule as
     _stripAccred; a coarse strip-them-all guard is what silently discarded
     columns the DB really had (Known Issues #28b). */
  const _PROFILE_COLS = ['tin', 'contact_position', 'telephone', 'city', 'website', 'payment_terms', 'vendor_category', 'vendor_group'];
  const _PROFILE_RE = /tin|contact_position|telephone|city|website|payment_terms|vendor_category|vendor_group/;
  function _stripProfile(payload, error) {
    const m = (error && ((error.message || '') + (error.details || ''))) || '';
    const named = _PROFILE_COLS.filter(c => new RegExp('\\b' + c + '\\b').test(m));
    const cols = named.length ? named : _PROFILE_COLS;
    const out = { ...payload };
    cols.forEach(c => delete out[c]);
    console.warn('[VendorDb] Dropped ' + cols.join(', ') + ' — NOT saved. If migrations/2026-08-20_vendor_accreditation_requests.sql has already run, this guard is wrong, not the schema. Postgres said: ' + m);
    return out;
  }
  async function updateVendor(id, fields) {
    const sb = await getSB();
    /* A vendor login writes through vendor_self_view, not `vendors`.
       Removing their SELECT on the base table also breaks their UPDATE — an
       UPDATE has to FIND its row and Postgres applies the SELECT policies to
       the rows it reads, so a base-table write would silently match zero rows.
       The view is auto-updatable, runs as its owner, and pins the row to the
       caller's own vendor; internal.vendor_edit_guard still fires underneath.
       updated_by / updated_by_name are NOT in the view (they can carry a
       Megawide officer's name), so the trigger stamps them server-side — which
       also means a vendor cannot forge the audit trail. */
    const rel = await _vendorRel();
    const viaView = rel === 'vendor_self_view';
    const payload = viaView
      ? { ...fields, updated_at: new Date().toISOString() }   // trigger overwrites; keeps the patch non-empty
      : { ...fields, ...(_stamp()) };
    const run = p => sb.from(rel).update(p).eq('id', id).select().single();

    let { data, error } = await run(payload);
    if (error && _isMissingCol(error, /updated_by|updated_by_name|updated_at/)) {
      const d2 = { ...payload }; delete d2.updated_by; delete d2.updated_by_name; delete d2.updated_at;
      ({ data, error } = await run(d2));
    }
    if (error && _isMissingCol(error, /vendor_code/)) {
      const d3 = { ...payload }; delete d3.vendor_code;
      ({ data, error } = await run(d3));
    }
    if (error && _isMissingCol(error, /accreditation/)) {
      ({ data, error } = await run(_stripAccred(payload, error)));
    }
    if (error && _isMissingCol(error, _PROFILE_RE)) {
      ({ data, error } = await run(_stripProfile(payload, error)));
    }
    // Deploy-safe for migrations/2026-08-20_vendor_edited_flag.sql — the acknowledge path
    // writes { vendor_edited_at: null }; drop it until the migration has run.
    if (error && _isMissingCol(error, /vendor_edited_at/)) {
      const d6 = { ...payload }; delete d6.vendor_edited_at;
      ({ data, error } = await run(d6));
    }
    if (error) throw error;
    return data;
  }
  async function approveVendor(id) { return updateVendor(id, { status: 'approved' }); }
  async function rejectVendor(id) { return updateVendor(id, { status: 'rejected' }); }
  async function setVendorStatus(id, status) { return updateVendor(id, { status }); }
  async function deleteVendor(id) {
    const sb = await getSB();
    const { error } = await sb.from('vendors').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Child tables (products / certifications / personnel) ────────────
  //
  // ⚠️ ARCHIVE, DON'T DELETE. migrations/2026-09-01_vendor_child_soft_delete.sql takes
  // DELETE away from the vendor role on all four child tables, so a vendor
  // login can no longer destroy its own offerings, certifications, personnel or
  // accreditation documents — tables that carry no audit trail and that this
  // app has no undo for. "Remove" in vendor-portal.html therefore stamps
  // archived_at, and staff can restore it from vendors.html.
  //
  // `remove()` is retained as a REAL hard DELETE, and RLS now allows it for
  // STAFF ONLY. Never call it as an archive fallback.
  const _ARCH_MIG = 'migrations/2026-09-01_vendor_child_soft_delete.sql';
  function _isMissingArchived(e) { return _isMissingCol(e, /archived_at/); }
  function _archiveUnavailable() {
    return new Error('Cannot archive — ' + _ARCH_MIG + ' has not been run on this ' +
      'database yet. Nothing was changed. Ask an administrator to run it.');
  }

  function _child(table, orderCol) {
    const ORD = orderCol || 'created_at';
    return {
      // opts.includeArchived — staff views pass this to see archived rows too.
      // The vendor portal never does, so an archived row reads as gone to them.
      async list(vendorId, opts) {
        const sb = await getSB();
        let q = sb.from(table).select('*').eq('vendor_id', vendorId);
        if (!(opts && opts.includeArchived)) q = q.is('archived_at', null);
        const { data, error } = await q.order(ORD);
        if (error) {
          // Pre-migration the column doesn't exist — nothing can have been
          // archived, so the unfiltered list IS the live list. Safe to degrade.
          if (_isMissingArchived(error)) {
            const r2 = await sb.from(table).select('*').eq('vendor_id', vendorId).order(ORD);
            if (r2.error) throw r2.error;
            return r2.data || [];
          }
          throw error;
        }
        return data || [];
      },
      async add(vendorId, fields) {
        const sb = await getSB();
        const { data, error } = await sb.from(table).insert({ ...fields, vendor_id: vendorId }).select().single();
        if (error) throw error;
        return data;
      },
      async update(id, fields) {
        const sb = await getSB();
        const { data, error } = await sb.from(table).update(fields).eq('id', id).select().single();
        if (error) throw error;
        return data;
      },
      // archived_by / archived_by_name are stamped SERVER-SIDE by
      // internal.stamp_archived(), so the client never sends them and the
      // attribution cannot be forged.
      async archive(id) {
        const sb = await getSB();
        const { error } = await sb.from(table).update({ archived_at: new Date().toISOString() }).eq('id', id);
        // ⚠️ NEVER fall back to remove() here. If the column is absent the right
        // outcome is a loud failure, not silently performing the destructive act
        // this change exists to prevent — same reasoning as bulkSetAccreditation,
        // where a quiet no-op would report success having changed nothing.
        if (error) { if (_isMissingArchived(error)) throw _archiveUnavailable(); throw error; }
      },
      async restore(id) {
        const sb = await getSB();
        const { error } = await sb.from(table).update({ archived_at: null }).eq('id', id);
        if (error) { if (_isMissingArchived(error)) throw _archiveUnavailable(); throw error; }
      },
      // Hard DELETE. Staff only — RLS rejects this for a vendor login.
      async remove(id) {
        const sb = await getSB();
        const { error } = await sb.from(table).delete().eq('id', id);
        if (error) throw error;
      },
    };
  }
  const _productsBase = _child('vendor_products');
  /* Deploy-safe optional columns on vendor_products:
       item_type   — migrations/2026-08-10_vendor_product_type.sql
       taxonomy_id — migrations/2026-08-20_product_taxonomy.sql
     Strips PRECISELY the column the error names (never both at once) and warns,
     per the _stripBuyback lesson (Known Issues #28b): a coarse strip-them-all
     guard silently discards a column the DB really does have. */
  const _PRODUCT_OPT = [
    { col: 'item_type',   re: /item_type/,   mig: 'migrations/2026-08-10_vendor_product_type.sql' },
    { col: 'taxonomy_id', re: /taxonomy_id/, mig: 'migrations/2026-08-20_product_taxonomy.sql' },
  ];
  function _stripProductOpt(fields, e) {
    for (const o of _PRODUCT_OPT) {
      if (fields && o.col in fields && _isMissingCol(e, o.re)) {
        const f2 = { ...fields }; delete f2[o.col];
        console.warn('[VendorDb] Dropped ' + o.col + ' — NOT saved. If ' + o.mig +
          ' has already run, this guard is wrong, not the schema. Postgres said: ' + (e && e.message));
        return f2;
      }
    }
    return null;
  }
  const products = {
    ..._productsBase,
    async add(vendorId, fields) {
      try { return await _productsBase.add(vendorId, fields); }
      catch (e) {
        const f2 = _stripProductOpt(fields, e);
        if (f2) return products.add(vendorId, f2);   // recurse: both columns may be absent
        throw e;
      }
    },
    async update(id, fields) {
      try { return await _productsBase.update(id, fields); }
      catch (e) {
        const f2 = _stripProductOpt(fields, e);
        if (f2) return products.update(id, f2);
        throw e;
      }
    },
  };
  const certifications = _child('vendor_certifications');
  const personnel = _child('vendor_personnel');

  // ── Vendor rates (staff-only, RLS-enforced) ──────────────────────────
  async function getVendorRates(vendorId) {
    const sb = await getSB();
    const { data, error } = await sb.from('vendor_rates').select('*').eq('vendor_id', vendorId).order('date_quoted', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  async function addVendorRate(vendorId, fields, profile) {
    const sb = await getSB();
    const { data, error } = await sb.from('vendor_rates').insert({ ...fields, vendor_id: vendorId, created_by: profile?.id || null }).select().single();
    if (error) throw error;
    return data;
  }
  async function deleteVendorRate(id) {
    const sb = await getSB();
    const { error } = await sb.from('vendor_rates').delete().eq('id', id);
    if (error) throw error;
  }
  // Upsert a rate row tied to a source WP (migrations/2026-08-10_vendor_rates_wp_link.sql
  // adds vendor_rates.wp_id + a partial unique index on (vendor_id,wp_id)
  // where wp_id is not null) — re-running the backfill updates the existing
  // row instead of duplicating it. Deploy-order-safe: if wp_id doesn't exist
  // yet, falls back to a plain insert (loses the de-dup guarantee until the
  // migration runs, but never fails the caller).
  function _isMissingWpIdCol(error) {
    return _isMissingCol(error, /wp_id/);
  }
  async function upsertRate(wpId, vendorId, projectId, fields, profile) {
    const sb = await getSB();
    const payload = {
      ...fields,
      wp_id: wpId,
      vendor_id: vendorId,
      project_id: projectId || null,
      created_by: profile?.id || null,
    };
    let { data, error } = await sb.from('vendor_rates')
      .upsert(payload, { onConflict: 'vendor_id,wp_id' })
      .select().single();
    // Fall back to a plain insert when wp_id is missing (pre-link migration) OR
    // when the (vendor_id,wp_id) unique CONSTRAINT isn't there yet — the partial
    // deploy state where migrations/2026-08-10_vendor_rates_wp_link.sql ran but not the _fix
    // (the ON CONFLICT error text names no column, so _isMissingWpIdCol misses it).
    if (error && (_isMissingWpIdCol(error) || /on conflict|unique or exclusion constraint/i.test((error.message || '') + (error.details || '')))) {
      const d2 = { ...payload }; delete d2.wp_id;
      ({ data, error } = await sb.from('vendor_rates').insert(d2).select().single());
    }
    if (error) throw error;
    return data;
  }

  // ── Certification file uploads (Supabase Storage, private bucket) ───
  async function uploadCertFile(vendorId, certId, file) {
    const sb = await getSB();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${vendorId}/${certId}_${Date.now()}_${safeName}`;
    const { error } = await sb.storage.from('vendor-certs').upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }
  async function getCertFileUrl(path) {
    if (!path) return null;
    const sb = await getSB();
    const { data, error } = await sb.storage.from('vendor-certs').createSignedUrl(path, 3600);
    if (error) throw error;
    return data?.signedUrl || null;
  }
  async function deleteCertFile(path) {
    if (!path) return;
    const sb = await getSB();
    await sb.storage.from('vendor-certs').remove([path]);
  }

  // ── Accreditation documents + requests ───────────────────────────────
  //  migrations/2026-08-20_vendor_accreditation_requests.sql. Both tables are optional at
  //  runtime: a missing table is reported as an empty list rather than thrown,
  //  so the portal and the staff modal still render on an un-migrated
  //  environment (the "request" button then explains why it is disabled).
  function _isMissingTable(error, name) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return error.code === '42P01' || (new RegExp(name, 'i').test(m) && /does not exist|schema cache|relation/i.test(m));
  }

  // Accreditation documents. Same archive-not-delete rule as the other three
  // child tables — these hold the BIR 2303 / business permit an accreditation
  // was granted on, so a vendor destroying them is the worst case of the four.
  const _docsBase = _child('vendor_documents', 'uploaded_at');
  // ── Self-registration claims ───────────────────────────────────
  // A vendor claims access from ONE public URL instead of a per-vendor invite
  // link (migrations/2026-09-01_vendor_self_registration.sql). Every write goes
  // through a SECURITY DEFINER RPC — vendor_claims has a SELECT policy and
  // nothing else — so a claimant can neither edit their own match result nor
  // approve themselves.
  // ── Change history / restore ──────────────────────────────────
  // migrations/2026-09-01_vendor_history_restore.sql keeps a full before/after
  // snapshot of every change to the five vendor tables.
  //
  // ⚠️ A snapshot of a `vendors` row contains `notes` and `accreditation_notes`
  // — the staff-only columns vendor_self_view hides. The table is readable by
  // staff write-roles ONLY. Never surface any of this in vendor-portal.html.
  const vendorHistory = {
    async forVendor(vendorId, limit) {
      const sb = await getSB();
      const { data, error } = await sb.from('vendor_history').select('*')
        .eq('vendor_id', vendorId).order('changed_at', { ascending: false })
        .limit(limit || 60);
      if (error) { if (_isMissingTable(error, 'vendor_history')) return []; throw error; }
      return data || [];
    },
    async restoreRow(historyId) {
      const sb = await getSB();
      const { error } = await sb.rpc('restore_vendor_row', { p_history_id: historyId });
      if (error) throw error;
    },
    // Always call this and show the result before restoreTo(). A blind bulk
    // revert is exactly the irreversible action this whole area exists to avoid.
    async preview(vendorId, whenIso) {
      const sb = await getSB();
      const { data, error } = await sb.rpc('preview_vendor_restore',
        { p_vendor: vendorId, p_when: whenIso });
      if (error) throw error;
      return data || [];
    },
    // Admin only, server-enforced.
    async restoreTo(vendorId, whenIso) {
      const sb = await getSB();
      const { data, error } = await sb.rpc('restore_vendor_to',
        { p_vendor: vendorId, p_when: whenIso });
      if (error) throw error;
      return data;
    },
  };

  const vendorClaims = {
    // Staff review queue, newest last. Returns [] pre-migration so vendors.html
    // still renders.
    async pending() {
      const sb = await getSB();
      const { data, error } = await sb.from('vendor_claims').select('*')
        .eq('status', 'pending').order('created_at');
      if (error) { if (_isMissingTable(error, 'vendor_claims')) return []; throw error; }
      return data || [];
    },
    async forVendor(vendorId) {
      const sb = await getSB();
      const { data, error } = await sb.from('vendor_claims').select('*')
        .eq('vendor_id', vendorId).order('created_at', { ascending: false });
      if (error) { if (_isMissingTable(error, 'vendor_claims')) return []; throw error; }
      return data || [];
    },
    // The claimant's own row. RLS scopes this to auth_user_id = auth.uid().
    async mine() {
      const sb = await getSB();
      const { data, error } = await sb.from('vendor_claims').select('*')
        .order('created_at', { ascending: false }).limit(1);
      if (error) { if (_isMissingTable(error, 'vendor_claims')) return null; throw error; }
      return (data && data[0]) || null;
    },
    // ⚠️ Returns only a claim id. The RPC deliberately does NOT report whether
    // or to whom it matched — that would make it an oracle for enumerating
    // vendors and confirming TINs. Do not "helpfully" surface a match here.
    async submit(company, contactName, vendorCode, tin, isNew) {
      const sb = await getSB();
      const { data, error } = await sb.rpc('submit_vendor_claim', {
        p_company: company, p_contact_name: contactName || null,
        p_vendor_code: vendorCode || null, p_tin: tin || null,
        p_is_new: !!isNew });
      if (error) throw error;
      return data;
    },
    // For a company that is genuinely not in the directory yet: creates the
    // vendors row, then delegates to the same approval path. Throws 23505 if
    // the name already exists — link to that record instead of duplicating it.
    async approveAsNew(claimId, name, notes) {
      const sb = await getSB();
      const { data, error } = await sb.rpc('create_vendor_from_claim', {
        p_claim: claimId, p_name: name || null, p_notes: notes || null });
      if (error) throw error;
      return data;
    },
    async approve(claimId, vendorId, notes) {
      const sb = await getSB();
      const { error } = await sb.rpc('approve_vendor_claim', {
        p_claim: claimId, p_vendor: vendorId, p_notes: notes || null });
      if (error) throw error;
    },
    async reject(claimId, notes) {
      const sb = await getSB();
      const { error } = await sb.rpc('reject_vendor_claim', {
        p_claim: claimId, p_notes: notes || null });
      if (error) throw error;
    },
  };

  const vendorDocuments = {
    ..._docsBase,
    async list(vendorId, opts) {
      // The whole table is optional (migrations/2026-08-20_vendor_accreditation_requests.sql),
      // so an absent table degrades to [] rather than breaking the portal.
      try { return await _docsBase.list(vendorId, opts); }
      catch (e) { if (_isMissingTable(e, 'vendor_documents')) return []; throw e; }
    },
    async add(vendorId, fields) {
      const sb = await getSB();
      const p = (typeof window !== 'undefined' && window.__profile) || {};
      const payload = { vendor_id: vendorId, ...fields, uploaded_at: new Date().toISOString(), uploaded_by: p.id || null, uploaded_by_name: p.name || p.email || null };
      const { data, error } = await sb.from('vendor_documents').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    // Staff only in practice: internal.vendor_doc_lock_guard lets every
    // non-vendor role through and raises 42501 for a vendor. The lock is
    // normally applied automatically when an accreditation is approved
    // (migrations/2026-09-01_vendor_doc_lock.sql); this is the manual escape
    // hatch for a document locked in error.
    async setLocked(id, locked) {
      const sb = await getSB();
      const p = (typeof window !== 'undefined' && window.__profile) || {};
      const patch = locked
        ? { locked_at: new Date().toISOString(), locked_by: p.id || null, locked_by_name: p.name || p.email || null }
        : { locked_at: null, locked_by: null, locked_by_name: null, locked_request_id: null };
      const { error } = await sb.from('vendor_documents').update(patch).eq('id', id);
      if (error) {
        // Loud, never a silent no-op: reporting success having changed nothing
        // would be worse than failing (the bulkSetAccreditation precedent).
        if (_isMissingCol(error, /locked_at/)) {
          throw new Error('Cannot change the document lock — ' +
            'migrations/2026-09-01_vendor_doc_lock.sql has not been run on this database yet. ' +
            'Nothing was changed.');
        }
        throw error;
      }
    },
  };

  // Documents share the private 'vendor-certs' bucket with certifications. Its
  // Storage policies key off the FIRST path segment being the vendor id, so
  // the '<vendorId>/' prefix here is load-bearing — do not reorder it.
  async function uploadVendorDoc(vendorId, docType, file) {
    const sb = await getSB();
    const safeName = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${vendorId}/doc_${docType}_${Date.now()}_${safeName}`;
    const { error } = await sb.storage.from('vendor-certs').upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }

  const accreditationRequests = {
    // Every request for one vendor, newest first.
    async forVendor(vendorId) {
      const sb = await getSB();
      const { data, error } = await sb.from('vendor_accreditation_requests').select('*').eq('vendor_id', vendorId).order('submitted_at', { ascending: false });
      if (error) { if (_isMissingTable(error, 'vendor_accreditation_requests')) return []; throw error; }
      return data || [];
    },
    // The staff review queue. Returns [] (not an error) pre-migration.
    async pending() {
      const sb = await getSB();
      const { data, error } = await sb.from('vendor_accreditation_requests').select('*').eq('status', 'pending').order('submitted_at');
      if (error) { if (_isMissingTable(error, 'vendor_accreditation_requests')) return []; throw error; }
      return data || [];
    },
    async create(vendorId, fields) {
      const sb = await getSB();
      const p = (typeof window !== 'undefined' && window.__profile) || {};
      const payload = { vendor_id: vendorId, kind: 'new', ...fields, status: 'pending', submitted_at: new Date().toISOString(), submitted_by: p.id || null };
      const { data, error } = await sb.from('vendor_accreditation_requests').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    // Staff decision. `status` is 'approved' or 'declined'. Approving is what
    // stamps the vendor's accreditation itself — the request row only records
    // that the decision was made, so both writes belong together here rather
    // than being left to each caller to remember.
    async decide(requestId, vendorId, status, notes) {
      const sb = await getSB();
      const p = (typeof window !== 'undefined' && window.__profile) || {};
      const { error } = await sb.from('vendor_accreditation_requests').update({
        status,
        decided_at: new Date().toISOString(),
        decided_by: p.id || null,
        decided_by_name: p.name || p.email || null,
        decision_notes: notes || null,
      }).eq('id', requestId);
      if (error) throw error;
      const patch = { accreditation: status === 'approved' ? 'accredited' : null, accreditation_date: _todayLocal() };
      if (notes) patch.accreditation_notes = notes;
      return updateVendor(vendorId, patch);
    },
    async withdraw(requestId) {
      const sb = await getSB();
      const { error } = await sb.from('vendor_accreditation_requests').update({ status: 'withdrawn' }).eq('id', requestId);
      if (error) throw error;
    },
  };

  // Local-parts date, never toISOString() on a bare date — that is UTC and
  // lands a day earlier in UTC+8 (the sCurve bug).
  function _todayLocal() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ── Vendor bids (Phase 2b — per-WP competitive bidding) ──────────────
  // vendor_bids only exists once migrations/2026-08-10_vendor_phase2b.sql has run; every
  // write here is deploy-order-safe the same way the rest of this file is —
  // a missing-table/column error is swallowed (logged, not thrown) so an
  // award save on an un-migrated environment doesn't fail the WP save it's
  // attached to.
  function _isMissingBidsTable(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return error.code === '42P01' || /vendor_bids/i.test(m) && /does not exist|schema cache|relation/i.test(m);
  }
  async function getBidsForWP(wpId) {
    const sb = await getSB();
    const { data, error } = await sb.from('vendor_bids').select('*').eq('wp_id', wpId).order('created_at');
    if (error) { if (_isMissingBidsTable(error)) return []; throw error; }
    const rows = data || [];
    if (!rows.length) return rows;
    const ids = [...new Set(rows.map(r => r.vendor_id))];
    const { data: vs } = await sb.from('vendors').select('id,name').in('id', ids);
    const nameById = {}; (vs || []).forEach(v => { nameById[v.id] = v.name; });
    return rows.map(r => ({ ...r, vendor_name: nameById[r.vendor_id] || null }));
  }
  async function getBidsForVendor(vendorId) {
    const sb = await getSB();
    const { data, error } = await sb.from('vendor_bids').select('*').eq('vendor_id', vendorId).order('created_at', { ascending: false });
    if (error) { if (_isMissingBidsTable(error)) return []; throw error; }
    const rows = data || [];
    if (!rows.length) return rows;
    // Merge in WP No. + description so the per-vendor Bid History can show
    // WHAT each bid was for (mirrors getBidsForWP's vendor-name merge).
    const wpIds = [...new Set(rows.map(r => r.wp_id).filter(Boolean))];
    if (!wpIds.length) return rows;
    const { data: wps } = await sb.from('work_packages').select('id,wp_no,description').in('id', wpIds);
    const byId = {}; (wps || []).forEach(w => { byId[w.id] = w; });
    return rows.map(r => ({ ...r, wp_no: byId[r.wp_id]?.wp_no || null, wp_description: byId[r.wp_id]?.description || null }));
  }
  async function upsertBid(wpId, vendorId, projectId, fields, profile) {
    const sb = await getSB();
    const payload = {
      ...fields,
      wp_id: wpId,
      vendor_id: vendorId,
      project_id: projectId || null,
      updated_by: profile?.id || null,
      updated_by_name: profile?.name || profile?.email || null,
      updated_at: new Date().toISOString(),
    };
    let { data, error } = await sb.from('vendor_bids')
      .upsert(payload, { onConflict: 'vendor_id,wp_id' })
      .select().single();
    if (error && _isMissingCol(error, /updated_by|updated_by_name|updated_at/)) {
      const d2 = { ...payload }; delete d2.updated_by; delete d2.updated_by_name; delete d2.updated_at;
      ({ data, error } = await sb.from('vendor_bids').upsert(d2, { onConflict: 'vendor_id,wp_id' }).select().single());
    }
    if (error) throw error;
    return data;
  }
  async function deleteBid(id) {
    const sb = await getSB();
    const { error } = await sb.from('vendor_bids').delete().eq('id', id);
    if (error) throw error;
  }
  // Award-time reconciliation: each winning vendor's bid → 'awarded' with today's
  // award date; every OTHER bid on the same WP → 'lost' (unless already
  // 'withdrawn' — a vendor that pulled out isn't "lost").
  //   `awards` accepts, in order of preference:
  //     • [{vendorId, amount}]  — each vendor's OWN negotiated awarded amount
  //     • [id, id, …] or a single id — no per-vendor breakdown; `totalAmount`
  //       is split EVENLY across them (fallback, e.g. Status-Tracker quick award)
  // No-op (never throws) when no vendor id is given.
  async function reconcileBidsOnAward(wpId, awards, totalAmount) {
    let list;
    if (Array.isArray(awards) && awards.length && awards[0] && typeof awards[0] === 'object' && 'vendorId' in awards[0]) {
      list = awards.filter(a => a && a.vendorId).map(a => ({ vendorId: a.vendorId, amount: (a.amount != null ? a.amount : null) }));
    } else {
      const ids = (Array.isArray(awards) ? awards : [awards]).filter(Boolean);
      const per = (totalAmount != null && ids.length) ? totalAmount / ids.length : null;
      list = ids.map(id => ({ vendorId: id, amount: per }));
    }
    // dedupe by vendorId (keep first)
    const seen = new Set();
    list = list.filter(a => !seen.has(a.vendorId) && seen.add(a.vendorId));
    if (!wpId || !list.length) return;
    try {
      const sb = await getSB();
      const todayIso = new Date().toISOString().slice(0, 10);
      for (const a of list) {
        await upsertBid(wpId, a.vendorId, null, {
          status: 'awarded',
          final_amount: a.amount,
          award_date: todayIso,
        }, (typeof window !== 'undefined' && window.__profile) || null);
      }
      // Mark every bid on this WP that ISN'T one of the winners as lost.
      const { error } = await sb.from('vendor_bids')
        .update({ status: 'lost' })
        .eq('wp_id', wpId)
        .not('vendor_id', 'in', `(${list.map(a => a.vendorId).join(',')})`)
        .neq('status', 'withdrawn');
      if (error && !_isMissingBidsTable(error)) throw error;
    } catch (err) {
      if (!_isMissingBidsTable(err)) throw err;
    }
  }
  // ── Vendor search / quick-create (used by the WP-form / Status-Tracker
  // Awarded Vendor combobox) ───────────────────────────────────────────
  async function searchApprovedVendors(query) {
    const sb = await getSB();
    let q = sb.from('vendors').select('id,name,status,accreditation').order('name').limit(20);
    if (query && query.trim()) q = q.ilike('name', `%${query.trim()}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  // Fetch just id+name for a set of vendor ids — used by the WP-form Proposed Vendors
  // multi-select combobox to resolve `proposed_vendor_ids` into display chips on edit-mode load
  // without pulling the whole ~900-row directory (see VendorDb.getVendors, which is heavier).
  async function getVendorsByIds(ids) {
    if (!ids || !ids.length) return [];
    const sb = await getSB();
    const { data, error } = await sb.from('vendors').select('id,name,status,accreditation').in('id', ids);
    if (error) throw error;
    return data || [];
  }
  // vendors.invite_email is NOT NULL (Phase 2a schema) — a staff-side quick
  // create from the WP form has no invite email to give it (that's only
  // collected via the vendors.html "Invite Vendor" flow), so this uses a
  // synthesized placeholder rather than relaxing the column to nullable.
  // The placeholder is never a real address a vendor could register with —
  // vendor-register.html only matches on invite_email + invite_claimed_at
  // is null, so this can't accidentally let someone claim a login; staff
  // can overwrite it later in vendors.html when formally inviting them.
  async function quickCreateVendor(name, profile) {
    const sb = await getSB();
    const placeholderEmail = `pending+${Date.now()}.${Math.random().toString(36).slice(2, 8)}@no-invite.local`;
    const payload = {
      name: (name || '').trim(),
      status: 'approved',
      invite_email: placeholderEmail,
      created_by: profile?.id || null,
      updated_by: profile?.id || null,
      updated_by_name: profile?.name || profile?.email || null,
      updated_at: new Date().toISOString(),
    };
    let { data, error } = await sb.from('vendors').insert(payload).select().single();
    if (error && _isMissingCol(error, /created_by|updated_by|updated_by_name|updated_at/)) {
      const d2 = { ...payload }; delete d2.created_by; delete d2.updated_by; delete d2.updated_by_name; delete d2.updated_at;
      ({ data, error } = await sb.from('vendors').insert(d2).select().single());
    }
    if (error) throw error;
    return data;
  }

  // ── Import vendors from the work-package directory (contractor +
  //    proposed_vendors free text) ────────────────────────────────────────
  //  Dedups by normalized name against existing vendors, creates the missing
  //  ones (via createVendor), and — when opts.linkWPs — sets
  //  work_packages.vendor_id on WPs whose `contractor` EXACTLY matches (RLS
  //  limits the WP updates to projects the caller can edit). Returns
  //  { created, linked, distinct }.
  function _normName(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function _splitVendors(s) { return String(s || '').split(/[\r\n;|]+/).map(x => x.trim()).filter(Boolean); }
  // Awarded-vendor splitter — the awarded `contractor` field can hold MULTIPLE
  // co-awarded vendors. Unlike proposed vendors it may use a SLASH separator
  // ("Vendor A / Vendor B"), so this adds "/" to the delimiter set. Comma/space
  // are still excluded on purpose ("Company, Inc." must stay intact).
  function _splitAwarded(s) { return String(s || '').split(/[\r\n;|/]+/).map(x => x.trim()).filter(Boolean); }
  async function importVendorsFromWPs(opts, profile) {
    opts = opts || {};
    const includeProposed = opts.includeProposed !== false;
    const linkWPs = !!opts.linkWPs;
    const sb = await getSB();
    // PAGINATED — a plain .select() stops at PostgREST's 1000-row default, which silently
    // hid ~40% of the work packages from this import (see CLAUDE.md / _pagedSelect).
    const rows = await _pagedSelect(() => sb.from('work_packages').select('id,contractor,proposed_vendors,vendor_id'));
    const existing = await getVendors();
    const byNorm = {}; existing.forEach(v => { byNorm[_normName(v.name)] = v; });
    // distinct display names from the WPs
    const names = new Map(); // norm -> best display string
    rows.forEach(w => {
      const push = nm => { const k = _normName(nm); if (k && !names.has(k)) names.set(k, nm.trim().replace(/\s+/g, ' ')); };
      // contractor can hold MULTIPLE co-awarded vendors (incl. slash-separated)
      _splitAwarded(w.contractor).forEach(push);
      if (includeProposed) _splitVendors(w.proposed_vendors).forEach(push);
    });
    let created = 0;
    for (const [k, disp] of names) {
      if (byNorm[k]) continue;
      const placeholder = `import+${Date.now()}.${created}.${Math.random().toString(36).slice(2, 7)}@no-invite.local`;
      const v = await createVendor({ name: disp, invite_email: placeholder, trade_categories: [] }, profile);
      byNorm[k] = v; created++;
    }
    let linked = 0;
    if (linkWPs) {
      for (const w of rows) {
        if (w.vendor_id) continue;
        // Only FK-link when the WP has exactly ONE awarded vendor — vendor_id is
        // a single FK and can't represent a co-award. Multi-vendor WPs still get
        // their vendor identity rows created above; analytics resolves them by name.
        const awardedNames = _splitAwarded(w.contractor);
        if (awardedNames.length !== 1) continue;
        const v = byNorm[_normName(awardedNames[0])];
        if (!v) continue;
        const { error: e3 } = await sb.from('work_packages').update({ vendor_id: v.id }).eq('id', w.id);
        if (!e3) linked++;
      }
    }
    return { created, linked, distinct: names.size };
  }

  // ── Backfill trade categories / products / bid history / rates for
  //    vendors that were created via importVendorsFromWPs (identity-only —
  //    name + placeholder email). Re-runnable: trades union (no dupes by
  //    construction), products dedupe by normalized description per vendor
  //    (checked against already-fetched existing products), bids/rates
  //    upsert on (vendor_id, wp_id) so a second run updates in place rather
  //    than duplicating. Rules (see CLAUDE.md Vendor Management section):
  //   - Trade Categories: from BOTH awarded (`contractor`) AND proposed
  //     (`proposed_vendors`) WPs — any non-blank `trade` on either
  //     is unioned into that vendor's trade_categories.
  //   - Products / Bids / Rates: ONLY from genuinely-awarded WPs
  //     (award_status==='Awarded' && awarded_cost>0 — mirrors the
  //     isMoneyAwarded predicate used everywhere else in the app, using
  //     awarded_cost since total_awarded is a generated column not read
  //     here). No original/negotiated offer data exists in work_packages,
  //     so bids only populate final_amount.
  async function backfillVendorDataFromWPs(profile) {
    const sb = await getSB();
    const _bfCols = 'id,project_id,wp_no,description,trade,type_of_works,contractor,proposed_vendors,vendor_id,awarded_vendor_ids,awarded_vendor_amounts,award_status,awarded_cost,awarding_date,actual_awarding_date';
    // PAGINATED for the same reason as importVendorsFromWPs above — this read used to stop
    // at 1000 rows, so trades/products/bids/rates were never backfilled for the rest.
    let rows;
    try { rows = await _pagedSelect(() => sb.from('work_packages').select(_bfCols)); }
    catch (e) {
      if (!_isMissingAwardedVendorIdsCol(e)) throw e;
      // pre-migration: the awarded-vendor array columns don't exist yet
      const cols2 = _bfCols.replace(',awarded_vendor_ids,awarded_vendor_amounts', '');
      rows = await _pagedSelect(() => sb.from('work_packages').select(cols2));
    }

    const vendors = await getVendors();
    const byNorm = {}; vendors.forEach(v => { byNorm[_normName(v.name)] = v; });
    const tradeSets = {}; // vendorId -> Set of trades (seeded from existing)
    vendors.forEach(v => { tradeSets[v.id] = new Set((v.trade_categories || [])); });

    const existingProducts = await getAllVendorProducts(); // [{vendor_id,category,description}]
    const productKeys = {}; // vendorId -> Set of normalized descriptions
    existingProducts.forEach(p => {
      const k = p.vendor_id;
      (productKeys[k] = productKeys[k] || new Set()).add(_normName(p.description));
    });
    const newProducts = {}; // vendorId -> Map(normDesc -> {category,description})

    const isAwarded = w => w.award_status === 'Awarded' && (w.awarded_cost || 0) > 0;

    const bidsToUpsert = [];
    const ratesToUpsert = [];
    let skippedNoVendor = 0;

    const resolveVendors = w => {
      const out = new Set();
      if (w.vendor_id) out.add(w.vendor_id);
      // contractor may hold multiple co-awarded vendors (incl. slash-separated)
      _splitAwarded(w.contractor).forEach(nm => { const v = byNorm[_normName(nm)]; if (v) out.add(v.id); });
      _splitVendors(w.proposed_vendors).forEach(nm => { const v = byNorm[_normName(nm)]; if (v) out.add(v.id); });
      return out;
    };

    rows.forEach(w => {
      const vids = resolveVendors(w);
      if (!vids.size) { skippedNoVendor++; return; }
      // Trades — union from every resolved vendor on this WP (awarded or
      // proposed), normalized to a canonical trade so casing/label variants
      // don't pile up on the vendor.
      if (w.trade) {
        const ct = CanonTrade(w.trade);
        vids.forEach(vid => { if (tradeSets[vid]) tradeSets[vid].add(ct); });
      }
      if (!isAwarded(w)) return;
      // Awarded-only: products / bids / rates. A WP can be awarded to MORE THAN
      // ONE vendor (co-award) — credit each. Per-vendor amount preference:
      //   1. the WP's own awarded_vendor_amounts[] (each vendor's negotiated
      //      awarded amount, index-aligned with awarded_vendor_ids) — authored
      //      via the WP form; use it verbatim so a re-run never clobbers the
      //      real breakdown with an even split.
      //   2. else split the WP's awarded_cost evenly across resolved vendors.
      const awardedVids = [];
      const amtByVid = {};
      const addAw = (id, amt) => { if (id && !awardedVids.includes(id)) { awardedVids.push(id); if (amt != null) amtByVid[id] = amt; } };
      const _ids = Array.isArray(w.awarded_vendor_ids) ? w.awarded_vendor_ids : [];
      const _amts = Array.isArray(w.awarded_vendor_amounts) ? w.awarded_vendor_amounts : [];
      if (_ids.length) {
        _ids.forEach((id, i) => addAw(id, _amts[i] != null ? _amts[i] : null));
      } else {
        if (w.vendor_id) addAw(w.vendor_id);
        _splitAwarded(w.contractor).forEach(nm => { const v = byNorm[_normName(nm)]; if (v) addAw(v.id); });
      }
      if (!awardedVids.length) return;
      const bidDate = w.awarding_date || w.actual_awarding_date || null;
      const awardDate = w.actual_awarding_date || w.awarding_date || null;
      // item_type from the WP's own Type field (Materials/Labor/Service) when set.
      const _it = ['Materials','Labor','Service'].includes(w.type_of_works) ? w.type_of_works : null;
      const evenShare = (w.awarded_cost || 0) / awardedVids.length;
      awardedVids.forEach(awardedVid => {
        const share = (amtByVid[awardedVid] != null) ? amtByVid[awardedVid] : evenShare;
        if (w.description) {
          const nk = _normName(w.description);
          const seen = productKeys[awardedVid] = productKeys[awardedVid] || new Set();
          if (!seen.has(nk)) {
            seen.add(nk);
            const map = newProducts[awardedVid] = newProducts[awardedVid] || new Map();
            if (!map.has(nk)) map.set(nk, { category: w.trade || null, description: w.description, item_type: _it });
          }
        }
        bidsToUpsert.push({
          wpId: w.id, vendorId: awardedVid, projectId: w.project_id,
          fields: {
            original_offer: null, negotiated_offer: null, final_amount: share,
            status: 'awarded', bid_date: bidDate, award_date: awardDate,
            notes: `Backfilled from WP ${w.wp_no || ''}`.trim(),
          },
        });
        ratesToUpsert.push({
          wpId: w.id, vendorId: awardedVid, projectId: w.project_id,
          fields: {
            item_description: w.description || null, trade: w.trade || null,
            rate: share, unit: null, date_quoted: awardDate,
            source: 'awarded contract',
          },
        });
      });
    });

    // Each loop is independently try/caught so one bad row (e.g. an
    // unmigrated column, an RLS-denied project, a transient network error)
    // can't abort the rest of the backfill. Since every write here is an
    // upsert/dedup-by-description, a partial run followed by a second run
    // safely finishes whatever didn't complete the first time.
    // Sample-error capture: the FIRST failure message per category is kept
    // (and surfaced in the vendors.html toast) so a failing backfill is
    // diagnosable without opening devtools — a raw Postgres/PostgREST error
    // (code/message/hint) is far more actionable than a bare failure count.
    const errMsg = (err) => (err && (err.message || err.hint || err.details)) ? [err.message, err.hint, err.details].filter(Boolean).join(' — ') : String(err);

    let tradesUpdated = 0, tradesFailed = 0, tradesError = null;
    for (const v of vendors) {
      const set = tradeSets[v.id];
      if (!set) continue;
      // Merge the WP-derived trades with the vendor's existing ones, then
      // canonicalize the whole set — this also collapses any raw variants
      // already stored on the vendor.
      const origArr = v.trade_categories || [];
      const union = CanonTrades([...origArr, ...set]);
      const changed = union.length !== origArr.length || union.some((t, i) => t !== origArr[i]);
      if (!changed) continue;
      try {
        await updateVendor(v.id, { trade_categories: union });
        tradesUpdated++;
      } catch (err) {
        tradesFailed++;
        if (!tradesError) tradesError = errMsg(err);
        console.error('[backfillVendorDataFromWPs] trade update failed', { vendorId: v.id, err });
      }
    }

    let productsAdded = 0, productsFailed = 0, productsError = null;
    for (const vendorId of Object.keys(newProducts)) {
      for (const { category, description, item_type } of newProducts[vendorId].values()) {
        try {
          await products.add(vendorId, { category, description, unit: null, item_type: item_type || null });
          productsAdded++;
        } catch (err) {
          productsFailed++;
          if (!productsError) productsError = errMsg(err);
          console.error('[backfillVendorDataFromWPs] product add failed', { vendorId, description, err });
        }
      }
    }

    let bidsUpserted = 0, bidsFailed = 0, bidsError = null;
    for (const b of bidsToUpsert) {
      try {
        await upsertBid(b.wpId, b.vendorId, b.projectId, b.fields, profile);
        bidsUpserted++;
      } catch (err) {
        bidsFailed++;
        if (!bidsError) bidsError = errMsg(err);
        console.error('[backfillVendorDataFromWPs] bid upsert failed', { wpId: b.wpId, vendorId: b.vendorId, err });
      }
    }

    let ratesUpserted = 0, ratesFailed = 0, ratesError = null;
    for (const r of ratesToUpsert) {
      try {
        await upsertRate(r.wpId, r.vendorId, r.projectId, r.fields, profile);
        ratesUpserted++;
      } catch (err) {
        ratesFailed++;
        if (!ratesError) ratesError = errMsg(err);
        console.error('[backfillVendorDataFromWPs] rate upsert failed', { wpId: r.wpId, vendorId: r.vendorId, err });
      }
    }

    return {
      tradesUpdated, tradesFailed, tradesError,
      productsAdded, productsFailed, productsError,
      bidsUpserted, bidsFailed, bidsError,
      ratesUpserted, ratesFailed, ratesError,
      skippedNoVendor,
    };
  }

  // All product rows across vendors (id + searchable text), for the directory's
  // "search by product/service" filter. Returns [] if the table is absent.
  async function getAllVendorProducts() {
    const sb = await getSB();
    // select('*') so item_type flows through when present but the query still
    // works before migrations/2026-08-10_vendor_product_type.sql runs. Paginated — products
    // across ~1000 vendors easily exceed the 1000-row default cap.
    try { return await _pagedSelect(() => sb.from('vendor_products').select('*')); }
    catch (e) { return []; }
  }

  // Merge duplicate vendors into a canonical one via the merge_vendors RPC
  // (migrations/2026-08-10_vendor_merge.sql). Throws a readable error if the migration
  // hasn't been run yet.
  /* merge_vendors DELETES the source rows, so anything held ONLY by a source is
     gone. It reassigns child rows, WP links and trade categories server-side —
     but it predates accreditation, and it does not know about vendor_code/TIN
     either. A duplicate pair is very often "the row the masterdata stamped" +
     "the row the WP import created", and whichever way the canonical pick
     falls, folding them must not lose the standing. Worst case: silently
     dropping a PROBLEMATIC flag.

     So the strongest standing is carried onto the target FIRST, and blank
     identity fields are filled from the sources. This sits inside
     mergeVendors() rather than in a caller because every path — the exact-
     duplicate cleanup, the fuzzy Merge tool, Merge All, and Split's fold of the
     garbled original — goes through here. */
  const _STANDING_RANK = { problematic: 3, accredited: 2, none: 0 };
  const _MERGE_FILL = ['vendor_code', 'tin', 'contact_person', 'contact_position', 'contact_number',
                       'telephone', 'contact_email', 'website', 'address', 'city', 'payment_terms',
                       'vendor_category', 'vendor_group'];
  async function _preserveOnMerge(targetId, sourceIds) {
    const sb = await getSB();
    const ids = [targetId].concat(sourceIds || []);
    const { data, error } = await sb.from('vendors').select('*').in('id', ids);
    // Never block a merge on this — it is a safety net, not the operation.
    if (error || !data || !data.length) { if (error) console.warn('[VendorDb] merge preserve skipped:', error.message); return; }
    const target = data.find(v => v.id === targetId);
    const sources = data.filter(v => v.id !== targetId);
    if (!target || !sources.length) return;
    const rank = v => _STANDING_RANK[accredKey(v.accreditation)] ?? 1;   // off-roster ranks above none
    const patch = {};
    // Strongest standing wins — a blacklist flag must survive the merge even
    // when the accredited row is the one being kept.
    const best = sources.reduce((a, b) => (rank(b) > rank(a) ? b : a), sources[0]);
    if (rank(best) > rank(target)) {
      patch.accreditation = best.accreditation;
      if (best.accreditation_notes) patch.accreditation_notes = best.accreditation_notes;
      if (best.accreditation_date) patch.accreditation_date = best.accreditation_date;
    }
    // Fill only what the target is missing — never overwrite curated data.
    _MERGE_FILL.forEach(k => {
      if (target[k] && String(target[k]).trim()) return;
      const from = sources.find(v => v[k] && String(v[k]).trim());
      if (from) patch[k] = from[k];
    });
    if (!Object.keys(patch).length) return;
    try { await updateVendor(targetId, patch); }
    catch (e) { console.warn('[VendorDb] could not carry data onto the merge target:', e.message); }
  }
  async function mergeVendors(targetId, sourceIds) {
    await _preserveOnMerge(targetId, sourceIds);
    const sb = await getSB();
    const { error } = await sb.rpc('merge_vendors', { p_target: targetId, p_sources: sourceIds });
    if (error) throw error;
  }
  // Full cascade delete via the delete_vendor_cascade RPC. Falls back to a
  // plain vendors delete if the RPC isn't deployed yet (PGRST202) — that plain
  // delete still fails on FK-linked vendors, surfaced as a normal error.
  // Bulk status change (approve/reject many). Chunked so a large id list can't
  // blow the PostgREST URL length; stamps audit + updated_at like updateVendor.
  // ── Exact-duplicate cleanup ────────────────────────────────────────────
  // Repeated runs of importVendorsFromWPs against a getVendors() that was capped at
  // PostgREST's 1000-row default re-created every vendor whose name sorted past the
  // cutoff, so the directory accumulated thousands of byte-identical duplicates. The
  // cap is fixed, but the rows remain. This groups vendors by NORMALIZED NAME (exact
  // match after trim/collapse-whitespace/lowercase — no fuzzy matching, so a group is
  // never a judgement call) and picks one canonical row per group.
  //
  // Canonical preference, most significant first: approved > has a claimed login >
  // has trade categories > has any linked activity (WP/bid/rate/product) > oldest
  // (the original import) > lowest id for a stable tie-break.
  function findExactDuplicateGroups(vendors, activeIds) {
    const act = activeIds instanceof Set ? activeIds : new Set(activeIds || []);
    const byNorm = new Map();
    (vendors || []).forEach(v => {
      const k = _normName(v.name);
      if (!k) return;                       // a blank name is not a "duplicate" of anything
      if (!byNorm.has(k)) byNorm.set(k, []);
      byNorm.get(k).push(v);
    });
    // Accreditation outranks everything: that row is the one a human (or the
    // masterdata seed) actually stamped, and keeping it means the merge has
    // nothing to carry over. `status` was dropped from the score — it is no
    // longer a user-facing concept and every legacy row shares one value.
    const score = v => (
      (accredKey(v.accreditation) !== ACCRED_NONE ? 32 : 0) +
      (v.invite_claimed_at               ? 8 : 0) +
      ((v.trade_categories || []).length ? 4 : 0) +
      (act.has(v.id)                     ? 2 : 0)
    );
    const groups = [];
    byNorm.forEach((rows, k) => {
      if (rows.length < 2) return;
      const sorted = [...rows].sort((a, b) => {
        const d = score(b) - score(a); if (d) return d;
        const ta = Date.parse(a.created_at || '') || Infinity, tb = Date.parse(b.created_at || '') || Infinity;
        if (ta !== tb) return ta - tb;      // oldest wins
        return String(a.id) < String(b.id) ? -1 : 1;
      });
      groups.push({ key: k, name: sorted[0].name, keep: sorted[0], remove: sorted.slice(1) });
    });
    // biggest groups first so a capped/aborted run clears the worst offenders
    groups.sort((a, b) => b.remove.length - a.remove.length);
    return groups;
  }
  // Fold each group's duplicates into its canonical row via the merge_vendors RPC, so
  // any child rows (products/certs/personnel/rates/bids) and WP links are reassigned
  // rather than deleted. onProgress(done, total, group) is called after each group.
  async function mergeExactDuplicates(groups, onProgress) {
    let merged = 0, removed = 0, failed = 0; const errors = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      try {
        // ONE SOURCE PER CALL. Folding several at once lets two sources collide with each
        // OTHER on vendor_rates/vendor_bids' UNIQUE(vendor_id, wp_id) — the server-side
        // cleanup can only compare against the target's rows as they stand at call time.
        // Sequentially, each source is de-duplicated against a target that already absorbed
        // the previous one, so the clash cannot arise (and it works on databases where the
        // hardened merge_vendors hasn't been re-run yet).
        for (const v of g.remove) await mergeVendors(g.keep.id, [v.id]);
        merged++; removed += g.remove.length;
      } catch (e) {
        failed++;
        if (errors.length < 5) errors.push((g.name || '?') + ': ' + (e && (e.message || e.code) || 'error'));
      }
      if (onProgress) { try { onProgress(i + 1, groups.length, g); } catch (_) {} }
    }
    return { merged, removed, failed, errors };
  }

  async function bulkSetVendorStatus(ids, status) {
    if (!ids || !ids.length) return;
    const sb = await getSB();
    const patch = { status, ..._stamp() };
    const CH = 200;
    for (let i = 0; i < ids.length; i += CH) {
      const { error } = await sb.from('vendors').update(patch).in('id', ids.slice(i, i + CH));
      if (error) throw error;
    }
  }
  // Bulk-set accreditation standing. `value` is a roster key (accredited /
  // problematic) or null to clear back to Not Accredited. Chunked
  // like bulkSetVendorStatus; deploy-safe — if the accreditation migration
  // hasn't run the whole call is refused loudly rather than silently no-oping
  // (unlike the per-row write paths, a bulk stamp that quietly does nothing
  // would read as "1,600 vendors updated" when nothing changed).
  async function bulkSetAccreditation(ids, value, extra) {
    if (!ids || !ids.length) return;
    const sb = await getSB();
    const patch = { accreditation: value || null, ...(extra || {}), ..._stamp() };
    const CH = 200;
    for (let i = 0; i < ids.length; i += CH) {
      const { error } = await sb.from('vendors').update(patch).in('id', ids.slice(i, i + CH));
      if (error) {
        if (_isMissingCol(error, /accreditation/)) {
          throw new Error('The accreditation columns are not in the database yet — run migrations/2026-08-19_vendor_accreditation.sql in the Supabase SQL editor first.');
        }
        throw error;
      }
    }
  }
  // Bulk cascade delete via delete_vendors_cascade RPC (chunked). Falls back to
  // looping the single-id RPC if the bulk one isn't deployed yet.
  /* What a delete would actually destroy, for the EXACT rows being deleted —
     not directory-wide totals, which are the number people reach for and which
     overstate the loss badly (directory-wide is every vendor's data, including
     the ones you are keeping). Chunked `.in()` reads so a long id list can't
     blow the PostgREST URL length. Returns zeros for a table that isn't
     deployed rather than throwing — this is a pre-flight, not the operation.  */
  async function getDeletionImpact(ids) {
    const out = { wps: 0, bids: 0, rates: 0, products: 0, documents: 0, withData: 0, logins: 0 };
    if (!ids || !ids.length) return out;
    const sb = await getSB();
    const CH = 150;
    const per = new Map();                       // vendor_id -> rows touching it
    const bump = id => { if (id) per.set(id, (per.get(id) || 0) + 1); };
    const tally = async (table, col, key) => {
      for (let i = 0; i < ids.length; i += CH) {
        const chunk = ids.slice(i, i + CH);
        const { data, error } = await sb.from(table).select(col).in(col, chunk);
        if (error) { console.warn(`[VendorDb] impact: ${table} skipped — ${error.message}`); return; }
        (data || []).forEach(r => { out[key]++; bump(r[col]); });
      }
    };
    await tally('work_packages', 'vendor_id', 'wps');
    await tally('vendor_bids', 'vendor_id', 'bids');
    await tally('vendor_rates', 'vendor_id', 'rates');
    await tally('vendor_products', 'vendor_id', 'products');
    await tally('vendor_documents', 'vendor_id', 'documents');
    out.withData = per.size;
    // A vendor who has actually claimed a login is a person you are cutting off,
    // not just a row — worth calling out separately.
    for (let i = 0; i < ids.length; i += CH) {
      const { data, error } = await sb.from('vendors').select('id,invite_claimed_at').in('id', ids.slice(i, i + CH));
      if (error) break;
      (data || []).forEach(v => { if (v.invite_claimed_at) out.logins++; });
    }
    return out;
  }
  /* Turn a vendor's real contact address into their INVITE address.
     vendor-register.html can only be claimed by the address sitting in
     vendors.invite_email (RLS: users_insert_vendor matches it against the
     JWT email, and requires invite_claimed_at to be null). Every row created
     by the WP import, quick-create or the masterlist seed carries a synthesized
     `…@no-invite.local` placeholder instead — so as things stand NO vendor can
     register at all, and self-service is unreachable. The masterlist did bring
     a real contact_email for over half the directory, so this promotes it.

     `lower(invite_email)` is UNIQUE, so two vendors sharing one address cannot
     both take it: the second is reported as a skip rather than throwing. */
  async function prepareInvites(ids) {
    const res = { set: 0, noEmail: 0, alreadyClaimed: 0, alreadySet: 0, duplicate: 0, failed: 0, examples: [] };
    if (!ids || !ids.length) return res;
    const sb = await getSB();
    // Every address already in use anywhere in the directory, so a promotion
    // cannot collide with a vendor outside the selection either.
    const taken = new Set();
    (await _pagedSelect(() => sb.from('vendors').select('id,invite_email')))
      .forEach(v => { if (v.invite_email) taken.add(String(v.invite_email).trim().toLowerCase()); });

    const CH = 150; const rows = [];
    for (let i = 0; i < ids.length; i += CH) {
      const { data, error } = await sb.from('vendors')
        .select('id,name,contact_email,invite_email,invite_claimed_at').in('id', ids.slice(i, i + CH));
      if (error) throw error;
      rows.push(...(data || []));
    }
    for (const v of rows) {
      if (v.invite_claimed_at) { res.alreadyClaimed++; continue; }
      const email = String(v.contact_email || '').trim().toLowerCase();
      const current = String(v.invite_email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.noEmail++; continue; }
      if (current === email) { res.alreadySet++; continue; }
      if (taken.has(email)) { res.duplicate++; if (res.examples.length < 5) res.examples.push(v.name); continue; }
      try {
        await updateVendor(v.id, { invite_email: email });
        taken.delete(current); taken.add(email);
        res.set++;
      } catch (e) { res.failed++; console.error('[prepareInvites]', v.name, e.message); }
    }
    return res;
  }
  async function bulkDeleteVendors(ids) {
    if (!ids || !ids.length) return;
    const sb = await getSB();
    const CH = 200;
    for (let i = 0; i < ids.length; i += CH) {
      const chunk = ids.slice(i, i + CH);
      const { error } = await sb.rpc('delete_vendors_cascade', { p_ids: chunk });
      if (error) {
        if (error.code === 'PGRST202' || /schema cache|does not exist/i.test((error.message || '') + (error.details || ''))) {
          for (const id of chunk) await deleteVendorCascade(id);
        } else throw error;
      }
    }
  }
  async function deleteVendorCascade(id) {
    const sb = await getSB();
    const { error } = await sb.rpc('delete_vendor_cascade', { p_id: id });
    if (error) {
      if (error.code === 'PGRST202' || /schema cache|does not exist/i.test((error.message || '') + (error.details || ''))) {
        return deleteVendor(id);
      }
      throw error;
    }
  }

  // ── Fuzzy "core name" matching ──────────────────────────────────────────
  // A directory vendor's name often carries extras the WP's free-text vendor
  // field doesn't — a leading "*", a "(LOCAL)"/"(IMPORTED)" tag, or trailing
  // legal/generic words (Inc, Corp, Construction, Trading…). Stripping those to
  // a comparable "core" lets "*JANGHO (LOCAL)" link to a WP that just says
  // "JANGHO" (or "JANGHO CURTAIN WALL"). Exposed on window so vendors.html's
  // precise per-WP filter uses the SAME rule as this gather.
  const _CORE_STOP = /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|enterprises|enterprise|construction|constructions|trading|traders|services|service|supply|supplies|industries|industrial|philippines|phils|ph|international|intl|and|the|of)\b/g;
  function _coreName(s) {
    let x = String(s == null ? '' : s).toLowerCase();
    x = x.replace(/\([^)]*\)/g, ' ');            // drop parentheticals e.g. (local)
    x = x.replace(/[*"'`.,/\\|;:&()\-_]+/g, ' '); // markers/punctuation → space
    x = x.replace(_CORE_STOP, ' ');               // legal/generic filler words
    return x.replace(/\s+/g, ' ').trim();
  }
  // needle appears in hay as a whole-word run (so "jangho" matches
  // "jangho curtain wall" but not "janghoo"); guarded to ≥4-char needles so a
  // tiny fragment can't match half the portfolio.
  function _coreWordContains(hay, needle) {
    if (!hay || !needle || needle.length < 4) return false;
    return new RegExp('\\b' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(hay);
  }
  // True if a directory vendor's core name matches one WP vendor-name string's
  // core (equal, or either is a whole-word run inside the other).
  function _coreMatch(vendorCore, wpName) {
    if (!vendorCore) return false;
    const nc = _coreName(wpName);
    if (!nc) return false;
    return nc === vendorCore || _coreWordContains(nc, vendorCore) || _coreWordContains(vendorCore, nc);
  }
  if (typeof window !== 'undefined') window.VendorMatch = { core: _coreName, wordContains: _coreWordContains, coreMatch: _coreMatch };

  // Work packages this vendor is linked to — as the AWARDED vendor
  // (work_packages.vendor_id, or a name match on the free-text `contractor`)
  // and/or a PROPOSED vendor (proposed_vendor_ids array, or a name match in
  // the free-text `proposed_vendors`). Gathers candidate rows via a few
  // targeted queries (id-based via .or(); name-based via separate .ilike()
  // queries so a vendor name containing a comma can't break PostgREST's
  // comma-delimited or()), then the CALLER computes the precise per-WP
  // proposed/awarded flags and drops any candidate that matches neither
  // (ilike is a broad substring gather, not the final test). Deploy-safe:
  // falls back to vendor_id-only if proposed_vendor_ids doesn't exist yet.
  async function getWorkPackagesForVendor(vendorId, vendorName) {
    const sb = await getSB();
    const cols = 'id,project_id,wp_no,description,trade,works,award_status,procurement_status,delivery_status,approved_budget_bcb,total_awarded,awarded_cost,contractor,vendor_id,awarded_vendor_ids,awarded_vendor_amounts,proposed_vendors,proposed_vendor_ids,awarding_date,actual_awarding_date';
    const byId = new Map();
    const add = rows => (rows || []).forEach(w => byId.set(w.id, w));
    try {
      const { data, error } = await sb.from('work_packages').select(cols).or(`vendor_id.eq.${vendorId},awarded_vendor_ids.cs.{${vendorId}},proposed_vendor_ids.cs.{${vendorId}}`);
      if (error) throw error;
      add(data);
    } catch (e) {
      // Deploy-safe fallback if awarded_vendor_ids/awarded_vendor_amounts/proposed_vendor_ids don't exist yet.
      const colsNoAwd = cols.replace(',awarded_vendor_ids', '').replace(',awarded_vendor_amounts', '');
      try {
        const { data, error: e2 } = await sb.from('work_packages').select(colsNoAwd).or(`vendor_id.eq.${vendorId},proposed_vendor_ids.cs.{${vendorId}}`);
        if (e2) throw e2; add(data);
      } catch (e3) {
        try { const { data } = await sb.from('work_packages').select(colsNoAwd.replace(',proposed_vendor_ids', '')).eq('vendor_id', vendorId); add(data); } catch (e4) { /* ignore */ }
      }
    }
    const nm = (vendorName || '').trim();
    if (nm) {
      const like = '%' + nm.replace(/[%_,]/g, ' ').trim() + '%';
      try { const { data } = await sb.from('work_packages').select(cols).ilike('contractor', like); add(data); } catch (e) { /* ignore */ }
      try { const { data } = await sb.from('work_packages').select(cols).ilike('proposed_vendors', like); add(data); } catch (e) { /* ignore */ }
      // Also gather by the fuzzy CORE name so a WP whose vendor text differs by a
      // "(LOCAL)" tag / legal suffix ("*JANGHO (LOCAL)" vs "JANGHO CURTAIN WALL")
      // still surfaces; the caller's core-aware filter confirms the real match.
      const core = _coreName(nm);
      if (core && core.length >= 4 && core !== nm.replace(/[%_,]/g, ' ').trim().toLowerCase()) {
        const likeCore = '%' + core.replace(/[%_,]/g, ' ').trim() + '%';
        try { const { data } = await sb.from('work_packages').select(cols).ilike('contractor', likeCore); add(data); } catch (e) { /* ignore */ }
        try { const { data } = await sb.from('work_packages').select(cols).ilike('proposed_vendors', likeCore); add(data); } catch (e) { /* ignore */ }
      }
    }
    return [...byId.values()];
  }

  /* ── Product taxonomy (migrations/2026-08-20_product_taxonomy.sql) ──────────────────
     Hybrid tree: L1 = Trade, L2 = Works (both `canonical`, mirroring the WP
     form's TRADE_WORKS ladder so vendor offerings and work packages share one
     vocabulary); L3+ are free staff-managed sub-nodes of any depth.

     Every read degrades to [] when the table is absent, so both the directory
     and the vendor portal still render before the migration is run. */
  let _taxCache = null;
  function _isMissingTable(e) {
    const m = ((e && (e.message || '')) + (e && e.details || '')).toLowerCase();
    return /product_taxonomy/.test(m) &&
           (/does not exist|schema cache|could not find/.test(m) || e?.code === '42P01' || e?.code === 'PGRST205');
  }
  async function getTaxonomy(force) {
    if (_taxCache && !force) return _taxCache;
    try {
      const sb = await getSB();
      const rows = await _pagedSelect(() =>
        sb.from('product_taxonomy').select('*').order('depth').order('sort_order').order('name'));
      _taxCache = rows || [];
    } catch (e) {
      if (!_isMissingTable(e)) console.warn('[Taxonomy] load failed:', e && e.message);
      _taxCache = [];
    }
    return _taxCache;
  }
  function _taxBust() { _taxCache = null; }
  /* Nest a flat node list into { ...node, children: [] } roots. Sorted by
     sort_order then name at every level (canonical order first, so the trades
     come out in TRADE_ORDER rather than alphabetically). */
  function buildTaxonomyTree(nodes) {
    const byId = new Map(), roots = [];
    (nodes || []).forEach(n => byId.set(n.id, { ...n, children: [] }));
    byId.forEach(n => {
      const p = n.parent_id && byId.get(n.parent_id);
      (p ? p.children : roots).push(n);
    });
    const sort = a => { a.sort((x, y) => (x.sort_order - y.sort_order) || x.name.localeCompare(y.name)); a.forEach(n => sort(n.children)); };
    sort(roots);
    return roots;
  }
  /* "Structural Works › Rebar › Deformed Bars" for any node, from the flat list. */
  function taxonomyPathLabel(nodes, id, sep) {
    const byId = new Map((nodes || []).map(n => [n.id, n]));
    const n = byId.get(id);
    if (!n) return '';
    return (n.path || []).map(pid => (byId.get(pid) || {}).name).filter(Boolean).join(sep || ' › ');
  }
  async function createTaxonomyNode(fields, profile) {
    const sb = await getSB();
    const payload = { ...fields, created_by: profile?.id || null, ...(_stamp()) };
    let { data, error } = await sb.from('product_taxonomy').insert(payload).select().single();
    if (error && _isMissingCol(error, /created_by|updated_by|updated_by_name|updated_at/)) {
      const d2 = { ...payload }; delete d2.created_by; delete d2.updated_by; delete d2.updated_by_name; delete d2.updated_at;
      ({ data, error } = await sb.from('product_taxonomy').insert(d2).select().single());
    }
    if (error) throw error;
    _taxBust();
    return data;
  }
  async function updateTaxonomyNode(id, fields) {
    const sb = await getSB();
    const run = p => sb.from('product_taxonomy').update(p).eq('id', id).select().single();
    let { data, error } = await run({ ...fields, ...(_stamp()) });
    if (error && _isMissingCol(error, /updated_by|updated_by_name|updated_at/)) {
      ({ data, error } = await run({ ...fields }));
    }
    if (error) throw error;
    _taxBust();
    return data;
  }
  /* Deleting a node cascades to its sub-nodes (FK on delete cascade) but NEVER
     to a vendor's offering — vendor_products.taxonomy_id is ON DELETE SET NULL,
     so those rows just fall back to unclassified. */
  async function deleteTaxonomyNode(id) {
    const sb = await getSB();
    const { error } = await sb.from('product_taxonomy').delete().eq('id', id);
    if (error) throw error;
    _taxBust();
  }
  /* Resolve a work package's (trade, works) to its canonical node — the Works
     node when it matches, else the Trade node. Case/space tolerant, and the
     trade is canonicalised first so a raw WP trade variant still resolves. */
  async function taxonomyNodeForWP(trade, works) {
    const nodes = await getTaxonomy();
    if (!nodes.length) return null;
    const norm = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
    const t = norm(window.CanonTrade ? window.CanonTrade(trade) : trade);
    if (!t) return null;
    const root = nodes.find(n => !n.parent_id && norm(n.name) === t);
    if (!root) return null;
    const w = norm(works);
    if (w) {
      const child = nodes.find(n => n.parent_id === root.id && norm(n.name) === w);
      if (child) return child;
    }
    return root;
  }
  /* Vendors who supply a given WP: every vendor with an offering AT or UNDER
     that (trade, works) node. Returns [{vendor, node, products[]}] sorted
     accredited-first, then by name — an officer wants the usable ones on top. */
  async function findVendorsForWP(trade, works) {
    const node = await taxonomyNodeForWP(trade, works);
    if (!node) return [];
    const nodes = await getTaxonomy();
    const under = new Set(nodes.filter(n => (n.path || []).includes(node.id)).map(n => n.id));
    let prods = [];
    try { prods = await getAllVendorProducts(); } catch (e) { return []; }
    const hits = new Map();
    prods.forEach(p => {
      if (!p.taxonomy_id || !under.has(p.taxonomy_id)) return;
      if (!hits.has(p.vendor_id)) hits.set(p.vendor_id, []);
      hits.get(p.vendor_id).push(p);
    });
    if (!hits.size) return [];
    const vendors = await getVendorsByIds([...hits.keys()]);
    const rank = v => (accredKey(v.accreditation) === 'accredited' ? 0 : accredKey(v.accreditation) === 'problematic' ? 2 : 1);
    return vendors
      .map(v => ({ vendor: v, node, products: hits.get(v.id) || [] }))
      .sort((a, b) => (rank(a.vendor) - rank(b.vendor)) || a.vendor.name.localeCompare(b.vendor.name));
  }


  /* ── Schedule performance pushed in by the Planners app ────────────────────
     Reads `planners_vendor_performance`, written ONLY by the Planners
     `push-vendor-perf` Edge Function with this project's service key.

     WARNING: EVERY ROW IS A SNAPSHOT, as fresh as the last push — the schedule
     lives in the Planners database and this app cannot read it. Callers MUST
     surface `pushed_at`; a vendor's SPI without a date invites someone to quote
     a stale figure in a negotiation.

     WARNING: returns [] rather than throwing when the table is absent, so a WPM
     deploy that runs ahead of migrations/2026-08-25_planners_vendor_performance.sql degrades
     to "no data yet" instead of breaking Vendor Management. */
  async function getVendorSchedulePerf(vendorId) {
    try {
      const sb = await getSB();
      let q = sb.from('planners_vendor_performance').select('*');
      if (vendorId) q = q.eq('vendor_id', vendorId);
      const { data, error } = await q.order('pushed_at', { ascending: false });
      if (error) return [];
      return data || [];
    } catch (e) { return []; }
  }
  return {
    getVendors, getVendor, createVendor, updateVendor, approveVendor, rejectVendor, setVendorStatus, deleteVendor,
    products, certifications, personnel,
    getTaxonomy, buildTaxonomyTree, taxonomyPathLabel, createTaxonomyNode, updateTaxonomyNode, deleteTaxonomyNode,
    taxonomyNodeForWP, findVendorsForWP,
    getVendorRates, addVendorRate, deleteVendorRate, upsertRate,
    uploadCertFile, getCertFileUrl, deleteCertFile,
    documents: vendorDocuments, uploadVendorDoc, requests: accreditationRequests, claims: vendorClaims, history: vendorHistory,
    getBidsForWP, getBidsForVendor, upsertBid, deleteBid, reconcileBidsOnAward,
    searchApprovedVendors, quickCreateVendor, getVendorsByIds,
    importVendorsFromWPs, getAllVendorProducts, mergeVendors, deleteVendorCascade,
    bulkSetVendorStatus, bulkSetAccreditation, findExactDuplicateGroups, mergeExactDuplicates, bulkDeleteVendors, getDeletionImpact, prepareInvites,
    backfillVendorDataFromWPs, getWorkPackagesForVendor,
    getVendorSchedulePerf,
  };
})();
window.VendorDb = VendorDb;

/* ══ TaxonomyPicker ═══════════════════════════════════════════════════════
   A searchable, cascading tree picker for a product_taxonomy node.

   Lives in db.js, NOT ui.js, because vendor-portal.html loads only auth.js +
   db.js — and this control is needed on BOTH that page and vendors.html.
   There is precedent for shared render helpers here (renderUserBar,
   buildRankTable).

   Self-contained in the established style (own injected CSS, theme-aware via
   the standard surface/text/border CSS custom properties, one delegated
   document listener). NOTE: never write a CSS var glob like --text-star-slash
   inside a block comment here — the slash closes the comment (the same trap
   that broke vendor-guide.js).

     const p = await TaxonomyPicker.mount(el, { value, onChange, placeholder });
     p.value()        -> selected node id or null
     p.set(id)        -> select programmatically
     p.refresh()      -> re-read the tree (after the manager edits it)

   Degrades to a plain disabled note when the taxonomy table is absent, so both
   pages still work before migrations/2026-08-20_product_taxonomy.sql is run. */
window.TaxonomyPicker = (function () {
  let _seq = 0;
  const _open = new Set();          // instances with an open popover

  function injectCss() {
    if (document.getElementById('taxpicker-css')) return;
    const s = document.createElement('style');
    s.id = 'taxpicker-css';
    s.textContent = `
.txp{position:relative;display:block}
.txp-btn{width:100%;display:flex;align-items:center;gap:7px;padding:8px 11px;border:1.5px solid var(--border-md,#e5e5e5);
  border-radius:8px;background:var(--surface,#fff);color:var(--text-primary,#231F20);font-family:inherit;font-size:0.8571rem;
  cursor:pointer;text-align:left;transition:border-color .15s}
.txp-btn:hover{border-color:var(--mw-red,#EE3124)}
.txp-btn[disabled]{cursor:not-allowed;opacity:.6}
.txp-btn .txp-lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.txp-btn .txp-lbl.txp-empty{color:var(--text-hint,#6E6C6C)}
.txp-btn .txp-x{color:var(--text-hint,#6E6C6C);font-size:1.1rem;line-height:1;padding:0 2px}
.txp-btn .txp-x:hover{color:var(--mw-red,#EE3124)}
.txp-pop{position:absolute;z-index:600;left:0;right:0;top:calc(100% + 4px);background:var(--surface,#fff);
  border:1.5px solid var(--mw-red,#EE3124);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);display:none;overflow:hidden}
.txp-pop.open{display:block}
.txp-search{width:100%;border:none;border-bottom:1px solid var(--border,rgba(0,0,0,.08));padding:9px 11px;
  font-family:inherit;font-size:0.8571rem;outline:none;background:transparent;color:var(--text-primary,#231F20)}
.txp-list{max-height:260px;overflow-y:auto;padding:4px 0}
.txp-row{display:flex;align-items:center;gap:4px;padding:5px 9px;cursor:pointer;font-size:0.8571rem;color:var(--text-primary,#231F20)}
.txp-row:hover{background:var(--mw-red-light,#FDECEA)}
.txp-row.sel{background:var(--mw-red-light,#FDECEA);font-weight:700}
.txp-tw{width:16px;flex-shrink:0;text-align:center;color:var(--text-hint,#6E6C6C);font-size:0.75rem}
.txp-tw:hover{color:var(--mw-red,#EE3124)}
.txp-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.txp-canon{font-size:0.6786rem;color:var(--text-hint,#6E6C6C);text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}
.txp-none{padding:12px;font-size:0.7857rem;color:var(--text-hint,#6E6C6C);text-align:center}
`;
    document.head.appendChild(s);
  }

  function esc(s) { return window.esc ? window.esc(s) : String(s == null ? '' : s); }

  async function mount(container, opts) {
    opts = opts || {};
    injectCss();
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return null;
    const uid = 'txp' + (++_seq);
    let nodes = [];
    try { nodes = await VendorDb.getTaxonomy(); } catch (e) { nodes = []; }

    let value = opts.value || null;
    let query = '';
    const expanded = new Set();

    const byId = () => new Map(nodes.map(n => [n.id, n]));
    const kids = pid => nodes.filter(n => (n.parent_id || null) === pid)
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));

    function expandTo(id) {
      const m = byId(), n = m.get(id);
      if (!n) return;
      (n.path || []).forEach(p => { if (p !== id) expanded.add(p); });
    }
    if (value) expandTo(value);

    function label() {
      if (!nodes.length) return null;
      if (!value) return null;
      return VendorDb.taxonomyPathLabel(nodes, value);
    }

    /* Search shows every matching node PLUS its ancestors, so a deep hit is
       still readable in context instead of appearing as a bare leaf. */
    function visibleSet() {
      if (!query) return null;
      const q = query.toLowerCase(), m = byId(), keep = new Set();
      nodes.forEach(n => {
        if (n.name.toLowerCase().includes(q)) {
          keep.add(n.id);
          (n.path || []).forEach(p => keep.add(p));
        }
      });
      return keep;
    }

    function rowsHtml() {
      if (!nodes.length) {
        return '<div class="txp-none">No product categories yet.<br>Run migrations/2026-08-20_product_taxonomy.sql, then add them under Data Tools.</div>';
      }
      const keep = visibleSet();
      const out = [];
      (function walk(pid, depth) {
        kids(pid).forEach(n => {
          if (keep && !keep.has(n.id)) return;
          const kidCount = kids(n.id).length;
          const isOpen = keep ? true : expanded.has(n.id);
          const tw = kidCount ? (isOpen ? '&#9662;' : '&#9656;') : '&nbsp;';
          out.push(
            `<div class="txp-row${n.id === value ? ' sel' : ''}" data-id="${n.id}" style="padding-left:${9 + depth * 15}px">` +
            `<span class="txp-tw" data-tw="${n.id}">${tw}</span>` +
            `<span class="txp-nm">${esc(n.name)}</span>` +
            (n.depth <= 2 ? `<span class="txp-canon">${n.depth === 1 ? 'trade' : 'works'}</span>` : '') +
            `</div>`);
          if (kidCount && isOpen) walk(n.id, depth + 1);
        });
      })(null, 0);
      if (!out.length) out.push('<div class="txp-none">No category matches that search.</div>');
      return out.join('');
    }

    function render() {
      const lbl = label();
      el.innerHTML =
        `<div class="txp" id="${uid}">` +
        `<button type="button" class="txp-btn" data-role="btn"${nodes.length ? '' : ' disabled'}>` +
        `<i class="ti ti-category"></i>` +
        `<span class="txp-lbl${lbl ? '' : ' txp-empty'}">${lbl ? esc(lbl) : esc(opts.placeholder || 'Choose a product category…')}</span>` +
        (lbl ? '<span class="txp-x" data-role="clear" title="Clear">&times;</span>' : '<i class="ti ti-chevron-down" style="opacity:.5"></i>') +
        `</button>` +
        `<div class="txp-pop" data-role="pop">` +
        `<input class="txp-search" data-role="search" placeholder="Search categories…" autocomplete="off" value="${esc(query)}"/>` +
        `<div class="txp-list" data-role="list">${rowsHtml()}</div>` +
        `</div></div>`;
      wire();
    }

    function popEl() { return el.querySelector('[data-role="pop"]'); }
    function close() { const p = popEl(); if (p) p.classList.remove('open'); _open.delete(api); }

    function wire() {
      const btn = el.querySelector('[data-role="btn"]');
      const pop = popEl();
      btn.addEventListener('mousedown', e => {
        if (e.target.closest('[data-role="clear"]')) {
          e.preventDefault(); e.stopPropagation();
          value = null; render();
          if (opts.onChange) opts.onChange(null, null);
          return;
        }
        e.preventDefault();
        const willOpen = !pop.classList.contains('open');
        _open.forEach(o => { if (o !== api) o._close(); });
        pop.classList.toggle('open', willOpen);
        if (willOpen) {
          _open.add(api);
          const s = el.querySelector('[data-role="search"]');
          if (s) setTimeout(() => s.focus(), 0);
        } else { _open.delete(api); }
      });
      const search = el.querySelector('[data-role="search"]');
      if (search) {
        search.addEventListener('input', () => {
          query = search.value.trim();
          el.querySelector('[data-role="list"]').innerHTML = rowsHtml();
        });
        // Typing must not bubble to a parent form/keyboard handler.
        search.addEventListener('keydown', e => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
      }
      const list = el.querySelector('[data-role="list"]');
      if (list) {
        list.addEventListener('mousedown', e => {
          e.preventDefault();
          const tw = e.target.closest('[data-tw]');
          if (tw) {   // twisty toggles, never selects
            const id = tw.dataset.tw;
            if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
            list.innerHTML = rowsHtml();
            return;
          }
          const row = e.target.closest('.txp-row');
          if (!row) return;
          value = row.dataset.id;
          expandTo(value);
          query = '';
          render();
          close();
          if (opts.onChange) {
            const n = byId().get(value) || null;
            opts.onChange(value, n);
          }
        });
      }
    }

    const api = {
      value: () => value,
      set(v) { value = v || null; if (value) expandTo(value); render(); },
      async refresh() { try { nodes = await VendorDb.getTaxonomy(true); } catch (e) {} render(); },
      _close: close,
      destroy() { _open.delete(api); el.innerHTML = ''; },
    };
    render();
    return api;
  }

  // One document listener for every instance.
  if (typeof document !== 'undefined') {
    document.addEventListener('mousedown', e => {
      if (!_open.size) return;
      if (e.target.closest('.txp')) return;
      [..._open].forEach(o => o._close());
    });
  }

  return { mount };
})();
