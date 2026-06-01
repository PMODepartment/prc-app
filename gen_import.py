import pandas as pd
import json
from datetime import datetime

df = pd.read_excel(
    'C:/Users/fmlozano/Downloads/AVR101. PRC. Work Package Monitoring (GenReq and Tower 1)_with Budget_REV001. 2025 02 24.xlsx',
    sheet_name='Work Package Monitoring', header=None)

key_cols = [
    2,   # cost_code
    4,   # wp_no
    5,   # wp_name (short description)
    8,   # detailed_description
    9,   # type_of_service
    10,  # type_of_procurement
    11,  # proposed_vendors
    12,  # po_jo_count
    13,  # po_jo_numbers
    14,  # type_of_contract
    22,  # responsible_team
    23,  # approver
    24,  # support_team
    26,  # surety_bond
    27,  # performance_bond
    28,  # warranty_bond
    30,  # budget_bcb
    31,  # awarded_cost
    32,  # additionals
    36,  # payment_terms_days
    37,  # dp_percent
    38,  # dp_terms
    39,  # dp_notes
    40,  # dp_release_date
    41,  # dp_amount
    42,  # retention_percent
    43,  # retention_amount
    44,  # retention_period
    113, # requires_approval
    114, # approver_name
    115, # approval_date
    116, # submittal_document_type
    118, # lead_time
    119, # awarding_date
    120, # actual_award_date
    122, # target_delivery
    124, # target_installation
    125, # target_completion
    127, # sourcing
    128, # rfq
    129, # bid_open
    130, # bid_closed
    131, # loa
    132, # contract_col
    133, # mob_del
    143, # purchase_request
    144, # awarding_status
    145, # responsible (duplicate check)
    146, # remarks
]

data = df.iloc[17:, key_cols].copy()
data.columns = [
    'cost_code', 'wp_no', 'wp_name', 'detailed_description',
    'type_service', 'type_procurement', 'proposed_vendors',
    'po_jo_count', 'po_jo_numbers', 'type_contract',
    'responsible_team', 'approver', 'support_team',
    'surety_bond', 'performance_bond', 'warranty_bond',
    'budget_bcb', 'awarded_cost', 'additionals',
    'payment_terms_days', 'dp_percent', 'dp_terms', 'dp_notes',
    'dp_release_date', 'dp_amount', 'retention_percent',
    'retention_amount', 'retention_period',
    'requires_approval', 'approver_name', 'approval_date',
    'submittal_document_type',
    'lead_time', 'awarding_date', 'actual_award_date',
    'target_delivery', 'target_installation', 'target_completion',
    'sourcing', 'rfq', 'bid_open', 'bid_closed', 'loa',
    'contract_col', 'mob_del',
    'purchase_request', 'awarding_status', 'responsible2', 'remarks'
]

data = data[pd.to_numeric(data['wp_no'], errors='coerce').notna()]
data['wp_no'] = data['wp_no'].apply(lambda x: int(float(x)))

def fmt_date(v):
    if pd.isna(v) or v is None: return None
    try:
        if isinstance(v, datetime): return v.strftime('%Y-%m-%d')
        return pd.to_datetime(v).strftime('%Y-%m-%d')
    except: return None

def cs(v):
    if pd.isna(v) or v is None: return None
    s = str(v).strip()
    return s if s else None

def cn(v):
    if pd.isna(v) or v is None: return None
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except: return None

def si(v):
    try: return int(float(v)) if pd.notna(v) else None
    except: return None

def yn(v):
    """Convert Yes/No/True/False to 'Yes' or 'No'"""
    if pd.isna(v) or v is None: return 'No'
    s = str(v).strip().lower()
    if s in ('yes', 'true', '1', 'y'): return 'Yes'
    return 'No'

def get_proc_status(row):
    if pd.notna(row['actual_award_date']): return 'Awarded'
    if pd.notna(row['loa']) and row['loa']: return 'Negotiation'
    if pd.notna(row['bid_closed']) and row['bid_closed']: return 'Evaluation'
    if pd.notna(row['bid_open']) and row['bid_open']: return 'Evaluation'
    if pd.notna(row['rfq']) and row['rfq']: return 'Solicitation'
    if pd.notna(row['sourcing']) and row['sourcing']: return 'Sourcing'
    return 'Not Started'

wps = []
for _, row in data.iterrows():
    budget = cn(row['budget_bcb'])
    awarded = cn(row['awarded_cost'])
    adds = cn(row['additionals']) or 0
    dp_pct = cn(row['dp_percent'])
    ret_pct = cn(row['retention_percent'])
    dp_amt = cn(row['dp_amount'])
    ret_amt = cn(row['retention_amount'])

    # Submittal document type — normalize casing
    sdt = cs(row['submittal_document_type'])
    if sdt and sdt.lower() == 'mock up': sdt = 'Mock-up'

    wp = {
        'project_id':               'AVR101',
        'wp_no':                    'WP-' + str(row['wp_no']),
        'description':              cs(row['wp_name']),
        'detailed_description':     cs(row['detailed_description']),
        'zone':                     None,
        'trade':                    cs(row['type_service']),
        'type_of_service':          cs(row['type_service']),
        'type_of_procurement':      cs(row['type_procurement']),
        'type_of_contract':         cs(row['type_contract']),
        'proposed_vendors':         cs(row['proposed_vendors']),
        'po_jo_count':              si(row['po_jo_count']) or 0,
        'po_jo_numbers':            cs(row['po_jo_numbers']),
        # Approval Matrix
        'responsible_team':         cs(row['responsible_team']),
        'approver':                 cs(row['approver']),
        'support_team':             cs(row['support_team']),
        # Insurance Bonds
        'surety_bond':              yn(row['surety_bond']),
        'performance_bond':         yn(row['performance_bond']),
        'warranty_bond':            yn(row['warranty_bond']),
        # Budget
        'approved_budget_bcb':      round(budget, 2) if budget else None,
        'awarded_cost':             round(awarded, 2) if awarded else None,
        'additionals':              round(adds, 2),
        # Payment Terms
        'payment_terms_days':       si(row['payment_terms_days']),
        'dp_percent':               round(dp_pct, 4) if dp_pct is not None else 0,
        'dp_terms':                 cs(row['dp_terms']),
        'dp_notes':                 cs(row['dp_notes']),
        'dp_release_date':          fmt_date(row['dp_release_date']),
        'dp_amount':                round(dp_amt, 2) if dp_amt else 0,
        'retention_percent':        round(ret_pct, 4) if ret_pct is not None else 0,
        'retention_amount':         round(ret_amt, 2) if ret_amt else 0,
        'retention_period':         cs(row['retention_period']),
        # Material / Subcon Submittals
        'requires_approval':        cs(row['requires_approval']) == 'Yes',
        'approver_name':            cs(row['approver_name']),
        'approval_date':            fmt_date(row['approval_date']),
        'submittal_document_type':  sdt,
        # Schedule
        'lead_time':                si(row['lead_time']),
        'awarding_date':            fmt_date(row['awarding_date']),
        'actual_awarding_date':     fmt_date(row['actual_award_date']),
        'target_delivery':          fmt_date(row['target_delivery']),
        'target_installation':      fmt_date(row['target_installation']),
        'target_completion':        fmt_date(row['target_completion']),
        # Status
        'procurement_status':       get_proc_status(row),
        'award_status':             'Awarded' if (awarded and awarded > 0) else 'Not Yet Awarded',
        'awarding_status':          'DUE' if cs(row['awarding_status']) == 'DUE' else None,
        'purchase_request':         cs(row['purchase_request']),
        'remarks':                  cs(row['remarks']),
        'review_status':            'approved',
    }
    wps.append(wp)

# Stats
print(f'Total WPs:          {len(wps)}')
print(f'Awarded:            {sum(1 for w in wps if w["award_status"]=="Awarded")}')
print(f'Not Yet Awarded:    {sum(1 for w in wps if w["award_status"]!="Awarded")}')
print(f'With DP:            {sum(1 for w in wps if w["dp_percent"] and w["dp_percent"] > 0)}')
print(f'With Retention:     {sum(1 for w in wps if w["retention_percent"] and w["retention_percent"] > 0)}')
print(f'With Surety Bond:   {sum(1 for w in wps if w["surety_bond"]=="Yes")}')
print(f'With Perf Bond:     {sum(1 for w in wps if w["performance_bond"]=="Yes")}')
print(f'With Warranty Bond: {sum(1 for w in wps if w["warranty_bond"]=="Yes")}')
print(f'Req\'d Approval:    {sum(1 for w in wps if w["requires_approval"])}')
print(f'With Submittal Type:{sum(1 for w in wps if w["submittal_document_type"])}')

js_data = json.dumps(wps, indent=2)

SB_URL = 'https://cayjeqeleenizbdzrums.supabase.co'
SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheWplcWVsZWVuaXpiZHpydW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3OTE5NzUsImV4cCI6MjA5NTM2Nzk3NX0.xWF6mSMTYSL65S56FTUSWFN0udJSY_yzUedU2CwFwpw'

html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>AVR101 Full Import</title>
  <style>
    body{font-family:monospace;padding:20px;background:#1a1a1a;color:#ccc}
    h2{color:#fff;margin-bottom:4px}
    p{font-size:12px;color:#aaa;margin:2px 0}
    .warn{color:#f87171}
    #log{white-space:pre-wrap;font-size:12px;line-height:1.6;max-height:78vh;overflow-y:auto;margin-top:12px}
    .ok{color:#4ade80}.err{color:#f87171}.info{color:#60a5fa}
    button{padding:10px 24px;background:#EE3124;color:#fff;border:none;border-radius:8px;
           font-size:14px;cursor:pointer;margin-top:12px}
    button:disabled{opacity:.5}
  </style>
</head>
<body>
<h2>AVR101 Full Import &mdash; WP_COUNT Work Packages</h2>
<p>Excel REV001 2025-02-24 &middot; All columns: Identity, Approval Matrix, Insurance Bonds, Submittals, Payment Terms, Schedule</p>
<p class="warn">&#9888; This will DELETE all existing AVR101 WPs and re-import with complete data.</p>
<button id="btn" onclick="runImport()">&#9654; Run Import</button>
<div id="log"></div>
<script type="module">
const SB_URL = 'SB_URL_PH';
const SB_KEY = 'SB_KEY_PH';
const {createClient} = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
const sb = createClient(SB_URL, SB_KEY);
const WPS = WPS_DATA_PH;
const log = document.getElementById('log');
function p(msg, cls) { log.innerHTML += '<span class="'+(cls||'')+'">' + msg + '</span>\\n'; log.scrollTop=log.scrollHeight; }

window.runImport = async function() {
  const btn = document.getElementById('btn');
  btn.disabled = true; log.innerHTML = '';

  const {data:{session}} = await sb.auth.getSession();
  if (!session) { p('Not logged in — open login.html first', 'err'); btn.disabled=false; return; }
  const {data:profile} = await sb.from('users').select('role').eq('id', session.user.id).single();
  if (!['admin','super_admin'].includes(profile && profile.role)) { p('Admin access required', 'err'); btn.disabled=false; return; }
  p('Authenticated: ' + session.user.email, 'ok');

  p('\\nDeleting existing AVR101 work packages...', 'info');
  const {error:delErr} = await sb.from('work_packages').delete().eq('project_id','AVR101');
  if (delErr) { p('Delete error: ' + delErr.message, 'err'); btn.disabled=false; return; }
  p('Deleted existing WPs', 'ok');

  p('\\nInserting ' + WPS.length + ' work packages...', 'info');
  const BATCH = 10;
  let inserted = 0, errors = 0;
  for (let i = 0; i < WPS.length; i += BATCH) {
    const batch = WPS.slice(i, i + BATCH);
    const {error} = await sb.from('work_packages').insert(batch);
    if (error) {
      p('Batch ' + (Math.floor(i/BATCH)+1) + ' error: ' + error.message, 'err');
      p('  First WP in batch: ' + batch[0].wp_no + ' - ' + (batch[0].description||''), 'err');
      errors++;
    } else {
      inserted += batch.length;
      p('WPs ' + (i+1) + '-' + Math.min(i+BATCH,WPS.length) + ' (' + inserted + '/' + WPS.length + ')', 'ok');
    }
  }
  p('\\n' + (errors===0 ? 'COMPLETE' : 'DONE WITH ERRORS') + ' - ' + inserted + ' inserted, ' + errors + ' batch errors', errors===0?'ok':'err');
  if (errors===0) p('Refresh the AVR101 dashboard to see updated data.', 'info');
  btn.disabled = false;
};
</script>
</body>
</html>"""

html = html.replace('WP_COUNT', str(len(wps)))
html = html.replace('SB_URL_PH', SB_URL)
html = html.replace('SB_KEY_PH', SB_KEY)
html = html.replace('WPS_DATA_PH', js_data)

out = 'C:/Users/fmlozano/OneDrive - Megawide Construction Corporation/Desktop/Procurement Dashboard/wpm/avr101-import.html'
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'\nSaved: {out}')
print(f'File size: {len(html)//1024} KB')
