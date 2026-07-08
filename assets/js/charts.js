const Charts = (() => {
  const reg = {};

  // Register datalabels plugin globally; default off — each chart opts in explicitly
  if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
    Chart.defaults.plugins.datalabels = { display: false };
  }

  function destroy(id) { if(reg[id]){reg[id].destroy();delete reg[id];} }

  // Legend: render LINE datasets as a line (not the default hollow box). Chart.js draws legend keys
  // as filled/bordered rectangles unless `usePointStyle` is on, in which case it uses each dataset's
  // `pointStyle`. So for any chart that has line datasets we enable usePointStyle and give line
  // datasets pointStyle 'line' (a short stroke) while non-line datasets (bars) keep a square 'rect'
  // so their legend key still reads as a box. Pure bar/donut charts are left untouched.
  function _lineLegendStyle(cfg) {
    const ds = (cfg.data && cfg.data.datasets) || [];
    const isLine = d => d.type === 'line' || (cfg.type === 'line' && !d.type);
    if (!ds.some(isLine)) return;
    const opts = cfg.options = cfg.options || {};
    const plugins = opts.plugins = opts.plugins || {};
    const legend = plugins.legend = plugins.legend || {};
    const labels = legend.labels = legend.labels || {};
    labels.usePointStyle = true;
    ds.forEach(d => { d.pointStyle = isLine(d) ? 'line' : (d.pointStyle || 'rect'); });
    // Reflect each dashed line (e.g. the Forecast series) as a DASHED key in the legend, not a solid one.
    labels.generateLabels = (chart) => {
      const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
      items.forEach(it => {
        const d = chart.data.datasets[it.datasetIndex];
        if (d && d.borderDash && d.borderDash.length) it.lineDash = d.borderDash;
      });
      return items;
    };
  }

  function make(id,cfg) {
    destroy(id);
    const ctx=document.getElementById(id);
    if(!ctx)return;
    _lineLegendStyle(cfg);
    // Apply dark-mode colours to the CONFIG before construction. Chart.js v4 caches bar element options,
    // so mutating dataset.backgroundColor after creation + update() fails to recolour bar fills (only line
    // strokes re-resolve). Baking the colours into the config before `new Chart()` avoids that entirely.
    if (document.body.classList.contains('dark-mode')) _themeConfig(cfg, true);
    reg[id]=new Chart(ctx.getContext('2d'),cfg);
    return reg[id];
  }

  // Called by initExpandableCharts() after resize — ensures chart redraws cleanly at new height
  function expand(id) { const c=reg[id]; if(c) c.update('none'); }
  function collapse(id) { const c=reg[id]; if(c) c.update('none'); }

  // Near-black brand hues (#282C28 etc. + its translucent bar variant) vanish on a dark canvas → remap to a
  // visible MID gray. #9B9999 (~4.5:1 on the panel) is deliberately 65 levels below #DCDBDB — which is
  // reused for the "Future"/"Not Due" buckets — so adjacent donut segments and stacked bars stay
  // distinguishable (at #B8B7B7 the two grays were nearly identical in the Status donut).
  function _darkRemap(c) {
    if (c === '#282C28' || c === '#231F20' || c === '#2B2C2B') return '#9B9999';
    if (c === 'rgba(40,44,40,0.55)' || c === 'rgba(40,44,40,0.7)') return 'rgba(155,153,153,0.92)';
    return c;
  }

  // Apply (or revert) dark-mode colours to a chart CONFIG — used both before construction (in make)
  // and before re-creation on theme toggle (in updateTheme). Operating on the config rather than a live
  // chart sidesteps Chart.js v4's bar element-option caching, which otherwise leaves bar FILLS stuck at
  // their original colour after update() (the line STROKES re-resolve, the bars don't — hence the bug
  // where Budget(BCB)/Planned bars stayed near-black on dark). Originals are cached on each dataset
  // (_origBg / _origBorder) so light mode restores exactly, and re-running is idempotent.
  function _themeConfig(cfg, dark) {
    const text = dark ? '#DCDBDB' : '#231F20';
    const grid = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
    const opts = cfg.options || {};
    if (opts.scales) {
      Object.values(opts.scales).forEach(s => {
        if (s.ticks) s.ticks.color = s.ticks.color === 'rgba(0,0,0,0)' ? s.ticks.color : text;
        if (s.grid)  s.grid.color  = grid;
        if (s.title) s.title.color = text;
      });
    }
    const leg = opts.plugins && opts.plugins.legend;
    if (leg && leg.labels) leg.labels.color = text;
    // Outside-bar value labels sit on the canvas background → must follow the theme (stacked/donut labels stay white)
    const dl = opts.plugins && opts.plugins.datalabels;
    if (dl && (dl.color === '#231F20' || dl.color === '#DCDBDB')) dl.color = dark ? '#DCDBDB' : '#231F20';
    // Donut/pie arcs, bar fills, and combo-chart cumulative lines: remap near-black hues; add arc separators in dark
    const type = cfg.type;
    ((cfg.data && cfg.data.datasets) || []).forEach(ds => {
      if (type === 'doughnut' || type === 'pie') {
        if (!ds._origBg && Array.isArray(ds.backgroundColor)) ds._origBg = ds.backgroundColor.slice();
        if (ds._origBg) ds.backgroundColor = dark ? ds._origBg.map(_darkRemap) : ds._origBg.slice();
        ds.borderColor = dark ? '#2B2C2B' : '#fff';
        ds.borderWidth = dark ? 2 : 0;
      } else {
        // bar fills (Budget(BCB)/Planned/Total WP use #282C28 — invisible on dark) and line strokes
        if (typeof ds.backgroundColor === 'string') {
          if (!('_origBg' in ds)) ds._origBg = ds.backgroundColor;
          ds.backgroundColor = dark ? _darkRemap(ds._origBg) : ds._origBg;
        }
        if (typeof ds.borderColor === 'string') {
          if (!('_origBorder' in ds)) ds._origBorder = ds.borderColor;
          ds.borderColor = dark ? _darkRemap(ds._origBorder) : ds._origBorder;
        }
      }
    });
  }

  // Called by AppTheme.apply() on theme toggle — re-creates every active chart with the re-themed config.
  // A destroy+rebuild is required (not mutate+update) because Chart.js v4 won't recolour cached bar fills.
  function updateTheme(dark) {
    Chart.defaults.color = dark ? '#DCDBDB' : '#231F20';
    Chart.defaults.borderColor = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
    Object.keys(reg).forEach(id => {
      const chart = reg[id];
      if (!chart || !chart.canvas) return;
      const canvas = chart.canvas;
      const cfg = { type: chart.config.type, data: chart.config.data, options: chart.config.options };
      _themeConfig(cfg, dark);
      chart.destroy();
      reg[id] = new Chart(canvas.getContext('2d'), cfg);
    });
  }

  // ── Data label helpers ───────────────────────────────────────
  function _mob() { return window.innerWidth < 640; }

  // Abbreviate a value already expressed in MILLIONS → "16.5B" / "2.4B" / "350M" / "5.1M".
  // Keeps billion-scale portfolio figures distinguishable from millions on charts.
  function _mAbbr(vM) {
    if (vM == null || isNaN(vM)) return '';
    const a = Math.abs(vM);
    if (a >= 1000) return (vM / 1000).toFixed(a >= 10000 ? 1 : 2) + 'B';
    if (a >= 100)  return Math.round(vM) + 'M';
    return (+vM.toFixed(1)) + 'M';
  }
  // Axis-tick formatter (value already in MILLIONS). Picks ONE unit for the whole axis from its
  // range so ticks don't mix M and B (e.g. "0M, 1.0B, 2.0B" → "0, 1B, 2B"). When Chart.js passes the
  // full `ticks` array we read its max; zero always renders as a bare "0".
  function _axM(vM, index, ticks) {
    if (vM == null || isNaN(vM)) return '';
    if (vM === 0) return '0';
    let max = Math.abs(vM);
    if (ticks && ticks.length) { for (const t of ticks) { const v=Math.abs(t.value); if (v>max) max=v; } }
    else if (this && this.max != null) { max = Math.abs(this.max); }
    if (max >= 1000) { const b = vM / 1000; return (Math.abs(b) >= 10 ? b.toFixed(0) : b.toFixed(1)) + 'B'; }
    return Math.round(vM) + 'M';
  }

  // Outside-end labels for non-stacked bar charts
  // axis: 'v' (vertical) or 'h' (horizontal)
  function _dlBar(fmtFn, axis) {
    const horiz = axis === 'h';
    return {
      display: ctx => {
        if (ctx.dataset.type === 'line') return false; // skip line in combo charts
        const v = ctx.dataset.data[ctx.dataIndex];
        return v != null && v > 0;
      },
      anchor: 'end',
      align: horiz ? 'right' : 'top',
      offset: 2,
      clamp: false,
      clip: false,
      color: document.body.classList.contains('dark-mode') ? '#DCDBDB' : '#231F20',
      font: { size: _mob() ? 7 : 9, weight: '600', family: 'Montserrat' },
      formatter: fmtFn
    };
  }

  // Center labels for stacked bar segments
  function _dlStacked(fmtFn) {
    return {
      display: ctx => {
        if (ctx.dataset.type === 'line') return false;
        const v = ctx.dataset.data[ctx.dataIndex];
        return v != null && v > 0;
      },
      anchor: 'center',
      align: 'center',
      clip: false,
      color: '#fff',
      textStrokeColor: 'rgba(0,0,0,0.3)',
      textStrokeWidth: 2,
      font: { size: _mob() ? 7 : 9, weight: '700', family: 'Montserrat' },
      formatter: fmtFn
    };
  }

  // Inside-segment labels for donut/pie charts — skip segments < minPct of total
  function _dlDonut(fmtFn, minPct) {
    const threshold = minPct != null ? minPct : 0.05;
    return {
      display: ctx => {
        const total = ctx.dataset.data.reduce((a, b) => a + (b || 0), 0);
        const v = ctx.dataset.data[ctx.dataIndex];
        return total > 0 && v / total >= threshold;
      },
      anchor: 'center',
      align: 'center',
      color: '#fff',
      textStrokeColor: 'rgba(0,0,0,0.3)',
      textStrokeWidth: 3,
      font: { size: _mob() ? 8 : 10, weight: '700', family: 'Montserrat' },
      formatter: fmtFn
    };
  }

  // Layout padding to prevent outside-bar labels from clipping at chart edges
  function _pad(axis) {
    return axis === 'h' ? { right: 42 } : { top: 20 };
  }

  // Decluttered vertical-bar labels for dense period charts (many months × 2 series):
  // Label the named series (rotate vertical, skip values below `frac` of that series' OWN max so
  // tiny bars don't pile up). `seriesColors` maps dataset.label -> light-mode label colour, letting
  // each series be visually distinguished (e.g. Budget=dark, Awarded=red). Dark mode brightens them.
  function _dlTidy(fmtFn, seriesColors, frac) {
    const f = frac != null ? frac : 0.06;
    const dark = document.body.classList.contains('dark-mode');
    // Dark-mode remap so labels stay legible on the dark surface (keep the hue distinction)
    const darkMap = { '#231F20': '#DCDBDB', '#282C28': '#DCDBDB', '#EE3124': '#FF7A6E', '#2D9B6F': '#5FD3A3' };
    return {
      display: ctx => {
        if (ctx.dataset.type === 'line') return false;
        if (!(ctx.dataset.label in seriesColors)) return false;
        const arr = ctx.dataset.data, v = arr[ctx.dataIndex];
        if (v == null || v <= 0) return false;
        const max = arr.reduce((m, x) => x > m ? x : m, 0);
        return max > 0 && v >= max * f;
      },
      anchor: 'end', align: 'top', offset: 2, rotation: 0, clamp: false, clip: false,
      color: ctx => { const c = seriesColors[ctx.dataset.label] || '#231F20'; return dark ? (darkMap[c] || '#DCDBDB') : c; },
      font: { size: _mob() ? 7 : 8, weight: '700', family: 'Montserrat' },
      formatter: fmtFn
    };
  }

  // ── Chart functions ──────────────────────────────────────────

  function statusByZone(id,wps){
    const zones=[...new Set(wps.map(w=>w.zone))].filter(Boolean);
    make(id,{type:'bar',data:{labels:zones,datasets:[
      {label:'Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status==='Awarded').length),backgroundColor:'#2D9B6F',borderRadius:4},
      {label:'Not Yet Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status!=='Awarded').length),backgroundColor:'#DCDBDB',borderRadius:4}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:_dlStacked(v=>v>0?v:'')},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:10}}},y:{stacked:true,ticks:{stepSize:1,font:{size:10}},grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function awardingLeadTime(id,wps){
    const data=wps.filter(w=>w.actual_awarding_date);
    const vals=data.map(w=>w.awarding_lead_time||0);
    make(id,{type:'bar',data:{labels:data.map(w=>w.wp_no),datasets:[{label:'Lead time',data:vals,borderRadius:3,backgroundColor:vals.map(v=>v>0?'rgba(226,75,74,0.75)':'rgba(45,155,111,0.75)')}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9},maxRotation:45,autoSkip:true}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'Days',font:{size:9}}}}}});
  }

  function budgetVsContract(id,wps){
    const data=wps.filter(w=>w.total_awarded!=null&&w.total_awarded>0);
    make(id,{type:'bar',data:{labels:data.map(w=>w.wp_no),datasets:[
      {label:'Budget',data:data.map(w=>+((w.approved_budget_bcb||0)/1e6).toFixed(2)),backgroundColor:'rgba(40,44,40,0.55)',borderRadius:3},
      {label:'Contract',data:data.map(w=>+((w.total_awarded||0)/1e6).toFixed(2)),backgroundColor:'rgba(45,155,111,0.75)',borderRadius:3}
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{display:false}},scales:{x:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  function varianceTrend(id,wps){
    const awarded=wps.filter(w=>w.actual_awarding_date&&w.total_awarded!=null);
    const months=[...new Set(awarded.map(w=>w.actual_awarding_date.slice(0,7)))].sort();
    let cumSav=0,cumLoss=0;
    const savData=[],lossData=[],netData=[];
    months.forEach(m=>{
      const net=awarded.filter(w=>w.actual_awarding_date.slice(0,7)===m).reduce((s,w)=>s+(w.variance||0),0);
      if(net>=0)cumSav=+(cumSav+net).toFixed(0);else cumLoss=+(cumLoss+Math.abs(net)).toFixed(0);
      savData.push(+(cumSav/1e6).toFixed(2));
      lossData.push(+(cumLoss/1e6).toFixed(2));
      netData.push(+(net/1e6).toFixed(2));
    });
    const labels=months.map(m=>new Date(m+'-01').toLocaleDateString('en-PH',{month:'short',year:'2-digit'}));
    make(id,{type:'line',data:{labels,datasets:[
      {label:'Savings',data:savData,borderColor:'#2D9B6F',backgroundColor:'rgba(45,155,111,.08)',fill:true,tension:.35,pointRadius:3,borderWidth:2},
      {label:'Overrun',data:lossData,borderColor:'#E24B4A',borderDash:[5,3],fill:false,tension:.35,pointRadius:3,borderWidth:2},
      {label:'Monthly',data:netData,type:'bar',backgroundColor:netData.map(v=>v>=0?'rgba(40,44,40,.45)':'rgba(226,75,74,.35)'),borderRadius:2,order:2}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function scheduleTimeline(id,wps){
    const data=wps.slice(0,12);
    const toMs=d=>d?new Date(d).getTime():null;
    make(id,{type:'scatter',data:{datasets:[
      {label:'Awarding',data:data.map((w,i)=>({x:toMs(w.awarding_date),y:i})),backgroundColor:'#282C28',pointRadius:5},
      {label:'Delivery',data:data.map((w,i)=>({x:toMs(w.target_delivery),y:i})),backgroundColor:'#D97706',pointRadius:5},
      {label:'Completion',data:data.map((w,i)=>({x:toMs(w.target_completion),y:i})),backgroundColor:'#5A5858',pointRadius:5}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{display:false}},scales:{x:{type:'linear',ticks:{font:{size:9},callback:v=>new Date(v).toLocaleDateString('en-PH',{month:'short',year:'2-digit'})},grid:{color:'rgba(0,0,0,.05)'}},y:{ticks:{font:{size:9},callback:(_,i)=>data[i]?.wp_no||'',stepSize:1},min:-0.5,max:data.length-0.5,grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function awardDonut(id,stats){
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return v + '\n' + (tot ? Math.round(v/tot*100) : 0) + '%';
    });
    make(id,{type:'doughnut',data:{labels:['Awarded','Not Yet'],datasets:[{data:[stats.awarded,stats.notAwarded],backgroundColor:['#2D9B6F','#DCDBDB'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false},datalabels:dl}}});
  }

  function consolidatedBudget(id,projects,allStats){
    const dl = _dlBar(v => v > 0 ? _mAbbr(v) : '', 'v');
    make(id,{type:'bar',data:{labels:projects.map(p=>p.id),datasets:[
      {label:'Budget',data:allStats.map(s=>+((s.totalBudget||0)/1e6).toFixed(1)),backgroundColor:'rgba(40,44,40,0.55)',borderRadius:4},
      {label:'Awarded',data:allStats.map(s=>+((s.totalContract||0)/1e6).toFixed(1)),backgroundColor:'rgba(45,155,111,0.75)',borderRadius:4}
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:_pad('v')},plugins:{legend:{display:false},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function budgetByTrade(id,wps,trades){
    const data=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6).toFixed(1));
    const awardedData=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6).toFixed(1));
    const dl = _dlBar(v => v > 0 ? _mAbbr(v) : '', 'h');
    make(id,{type:'bar',data:{labels:trades,datasets:[
      {label:'Budget',data:data,backgroundColor:'rgba(40,44,40,0.55)',borderRadius:4},
      {label:'Awarded',data:awardedData,backgroundColor:'rgba(45,155,111,0.7)',borderRadius:4}
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:_pad('h')},plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:dl},scales:{x:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  function awardRateByTrade(id,wps,trades){
    const rates=trades.map(t=>{
      const tw=wps.filter(w=>w.trade===t);
      return tw.length?Math.round(tw.filter(w=>w.award_status==='Awarded').length/tw.length*100):0;
    });
    const dl = _dlBar(v => v > 0 ? v+'%' : '', 'h');
    make(id,{type:'bar',data:{labels:trades,datasets:[{label:'Award Rate %',data:rates,backgroundColor:rates.map(r=>r>=80?'#2D9B6F':r>=50?'#D97706':'#EE3124'),borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:_pad('h')},plugins:{legend:{display:false},datalabels:dl},scales:{x:{min:0,max:100,ticks:{font:{size:9},callback:v=>v+'%'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  // ── Helper: quarter key / label ──────────────────────────────
  function getQKey(d){ const q=Math.ceil((d.getMonth()+1)/3); return `${d.getFullYear()}-${q}`; }
  function qLabel(k){ const[y,q]=k.split('-'); return `Q${q} '${y.slice(2)}`; }

  // Effective AWARD date for plotting an awarded WP. Uses the actual award date, falling back to the
  // PLANNED award date when actual isn't captured (WP-Monitoring imports record award_status +
  // total_awarded but no actual date). CLAMPED to today — a work package can never be awarded in the
  // future, so any actual/fallback date beyond today is pulled back to the current day.
  function _awDate(w){
    const raw = w.actual_awarding_date || w.awarding_date;
    if(!raw) return null;
    const d = new Date(raw);
    if(isNaN(d)) return null;
    const now = new Date();
    return d > now ? now : d;
  }
  // Actual award date (no planned fallback) clamped to today — for the Planned-vs-Actual count charts.
  function _actAwDate(w){ if(!w.actual_awarding_date) return null; const d=new Date(w.actual_awarding_date); if(isNaN(d)) return null; const now=new Date(); return d>now?now:d; }

  // Budget (BCB) and Awarded by Period — MONTHLY combo chart
  // opts.hideAwarded: backlog instances pass only not-awarded WPs, whose awarded cost is ₱0 by
  // definition — drop the two always-zero Awarded series instead of drawing a flat line at 0M.
  function budgetAwardedByPeriodMonthly(id, wps, opts){
    // Awarded amount is placed by its actual award date, falling back to the PLANNED award date when
    // actual_awarding_date isn't captured (WP-Monitoring imports record award_status + total_awarded but
    // no actual date — without the fallback the Awarded bars / Cumulative Awarded line are flat at 0).
    const awDate=_awDate;   // actual→planned fallback, clamped to today (no future awards)
    const isAwd=w=>w.award_status==='Awarded'&&(w.total_awarded||0)>0;   // awarded = flagged Awarded AND has a cost
    const mSet=new Set();
    wps.forEach(w=>{ if(w.awarding_date){ const d=new Date(w.awarding_date); mSet.add(d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0')); } if(isAwd(w)&&awDate(w)){ const d=awDate(w); mSet.add(d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0')); } });
    _extendForecastAxis(mSet, wps, 'm', !!(opts&&opts.hideAwarded));
    if(!mSet.size){ destroy(id); return; }
    const months=[...mSet].sort();
    const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mLabel=k=>{ const[y,m]=k.split('-'); return MONTH_NAMES[parseInt(m)-1]+' \''+y.slice(2); };
    const getMKey=d=>d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0');
    const budgetData=months.map(mk=>wps.filter(w=>w.awarding_date&&getMKey(new Date(w.awarding_date))===mk).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6);
    const awardedData=months.map(mk=>wps.filter(w=>isAwd(w)&&awDate(w)&&getMKey(awDate(w))===mk).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6);
    let cb=0,ca=0;
    const cumB=budgetData.map(v=>(cb=+(cb+v).toFixed(1)));
    const cumA=awardedData.map(v=>(ca=+(ca+v).toFixed(1)));
    // Cumulative Awarded must NOT run into the future — nothing is awarded after today. Null out the
    // line past the current month so it ends at today instead of drawing flat to the last budget month.
    const _nowMK=(()=>{const d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0');})();
    const cumADisp=months.map((mk,i)=> mk>_nowMK ? null : cumA[i]);
    const mob=_mob();
    const tidy=!!(opts&&opts.tidyLabels);
    const dl=mob?{display:false}:(tidy?_dlTidy(v=>v>0?_mAbbr(v):'',{'Budget (BCB)':'#231F20','Awarded':'#EE3124'}):_dlBar(v=>v>0?_mAbbr(v):'','v'));
    const hideAwd=!!(opts&&opts.hideAwarded);
    make(id,{type:'bar',data:{labels:months.map(mLabel),datasets:[
      {label:'Budget (BCB)',data:budgetData,backgroundColor:'#282C28',borderRadius:3,order:2},
      ...(hideAwd?[]:[{label:'Awarded',data:awardedData,backgroundColor:'#EE3124',borderRadius:3,order:2}]),
      {label:'Cumulative Budget',data:cumB,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:mob?1:2,fill:false,tension:.1,order:1},
      ...(hideAwd?[]:[{label:'Cumulative Awarded',data:cumADisp,type:'line',borderColor:'#EE3124',borderWidth:2,pointRadius:mob?1:2,fill:false,tension:.1,order:1,spanGaps:false}]),
      ...(hideAwd?[]:[{label:'Forecast',data:_wpForecastLine(months,getMKey,wps,cumA,w=>(w.approved_budget_bcb||0)/1e6,w=>w.award_status==='Awarded'&&(w.total_awarded||0)>0),type:'line',borderColor:'#EE3124',borderDash:[6,4],borderWidth:2,pointRadius:0,fill:false,tension:.1,order:1,spanGaps:false}]),
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:mob?0:_pad('v')},plugins:{legend:{position:'bottom',labels:{font:{size:mob?8:10},boxWidth:mob?10:12,padding:mob?5:8}},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:mob?7:9},maxRotation:45,autoSkip:true,maxTicksLimit:mob?8:24}},y:{ticks:{font:{size:mob?8:9},callback:_axM},grid:{color:'rgba(0,0,0,.05)'},title:{display:!mob,text:'₱ Million',font:{size:9}}}}}});
  }

  // Budget (BCB) and Awarded by Period — quarterly combo chart (opts.hideAwarded: see monthly variant)
  function budgetAwardedByPeriod(id, wps, opts){
    // Awarded amount falls back to the PLANNED award date when actual_awarding_date isn't captured
    // (see budgetAwardedByPeriodMonthly for the why) so the Awarded series isn't flat at 0.
    const awDate=_awDate;   // actual→planned fallback, clamped to today (no future awards)
    const isAwd=w=>w.award_status==='Awarded'&&(w.total_awarded||0)>0;   // awarded = flagged Awarded AND has a cost
    const qSet=new Set();
    wps.forEach(w=>{ if(w.awarding_date) qSet.add(getQKey(new Date(w.awarding_date))); if(isAwd(w)&&awDate(w)) qSet.add(getQKey(awDate(w))); });
    _extendForecastAxis(qSet, wps, 'q', !!(opts&&opts.hideAwarded));
    if(!qSet.size){ destroy(id); return; }
    const quarters=[...qSet].sort();
    const labels=quarters.map(qLabel);
    const budgetData=quarters.map(qk=>wps.filter(w=>w.awarding_date&&getQKey(new Date(w.awarding_date))===qk).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6);
    const awardedData=quarters.map(qk=>wps.filter(w=>isAwd(w)&&awDate(w)&&getQKey(awDate(w))===qk).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6);
    let cb=0,ca=0;
    const cumB=budgetData.map(v=>(cb=+(cb+v).toFixed(1)));
    const cumA=awardedData.map(v=>(ca=+(ca+v).toFixed(1)));
    // Cumulative Awarded must NOT run into the future — null it past the current quarter so the line
    // ends at today instead of drawing flat to the last (future) budget quarter.
    const _nowQK=getQKey(new Date());
    const cumADisp=quarters.map((qk,i)=> qk>_nowQK ? null : cumA[i]);
    const mob=_mob();
    const tidy=!!(opts&&opts.tidyLabels);
    const dl=mob?{display:false}:(tidy?_dlTidy(v=>v>0?_mAbbr(v):'',{'Budget (BCB)':'#231F20','Awarded':'#EE3124'}):_dlBar(v=>v>0?_mAbbr(v):'','v'));
    const hideAwd=!!(opts&&opts.hideAwarded);
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Budget (BCB)',data:budgetData,backgroundColor:'#282C28',borderRadius:3,order:2},
      ...(hideAwd?[]:[{label:'Awarded',data:awardedData,backgroundColor:'#EE3124',borderRadius:3,order:2}]),
      {label:'Cumulative Budget',data:cumB,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:mob?1:2,fill:false,tension:.1,order:1},
      ...(hideAwd?[]:[{label:'Cumulative Awarded',data:cumADisp,type:'line',borderColor:'#EE3124',borderWidth:2,pointRadius:mob?1:2,fill:false,tension:.1,order:1,spanGaps:false}]),
      ...(hideAwd?[]:[{label:'Forecast',data:_wpForecastLine(quarters,getQKey,wps,cumA,w=>(w.approved_budget_bcb||0)/1e6,w=>w.award_status==='Awarded'&&(w.total_awarded||0)>0),type:'line',borderColor:'#EE3124',borderDash:[6,4],borderWidth:2,pointRadius:0,fill:false,tension:.1,order:1,spanGaps:false}]),
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:mob?0:_pad('v')},plugins:{legend:{position:'bottom',labels:{font:{size:mob?8:10},boxWidth:mob?10:12,padding:mob?5:8}},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:mob?7:9},maxRotation:45,autoSkip:true}},y:{ticks:{font:{size:mob?8:9},callback:_axM},grid:{color:'rgba(0,0,0,.05)'},title:{display:!mob,text:'₱ Million',font:{size:9}}}}}});
  }

  // Work Package by Trade — horizontal grouped bar
  function wpByTrade(id, wps){
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))];
    const data=trades.map(t=>({t,total:wps.filter(w=>w.trade===t).length,awarded:wps.filter(w=>w.trade===t&&w.award_status==='Awarded').length})).sort((a,b)=>b.total-a.total);
    const dl = _dlBar(v => v > 0 ? v : '', 'h');
    make(id,{type:'bar',data:{labels:data.map(d=>d.t),datasets:[
      {label:'Total WP',data:data.map(d=>d.total),backgroundColor:'#282C28',borderRadius:3},
      {label:'Awarded WP',data:data.map(d=>d.awarded),backgroundColor:'#EE3124',borderRadius:3},
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:_pad('h')},plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}},datalabels:dl},scales:{x:{ticks:{font:{size:9},stepSize:1},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'Count',font:{size:9}}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  // Work Package by Status — donut
  function wpStatusDonut(id, wps){
    const today=new Date();
    const awarded=wps.filter(w=>w.award_status==='Awarded').length;
    const na=wps.filter(w=>w.award_status!=='Awarded');
    const due=na.filter(w=>w.awarding_date&&new Date(w.awarding_date)<today).length;
    const notDue=na.filter(w=>!w.awarding_date||new Date(w.awarding_date)>=today).length;
    const total=wps.length;
    // Only include categories that actually have WPs — e.g. a backlog (not-awarded only) set has
    // zero Awarded, so "Awarded" shouldn't appear in the donut or its legend.
    const cats=[['Awarded',awarded,'#EE3124'],['Due but Not Awarded',due,'#282C28'],['Not Due',notDue,'#DCDBDB']].filter(c=>c[1]>0);
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return v + '\n' + (tot ? Math.round(v/tot*100) : 0) + '%';
    });
    make(id,{type:'doughnut',data:{labels:cats.map(c=>c[0]),datasets:[{data:cats.map(c=>c[1]),backgroundColor:cats.map(c=>c[2]),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},tooltip:{callbacks:{label:ctx=>` ${ctx.label}: ${ctx.raw} (${total?((ctx.raw/total)*100).toFixed(1):'0'}%)`}},datalabels:dl}}});
  }

  // Work Package by Status — donut by BCB value
  function wpStatusDonutValue(id, wps){
    const today=new Date();
    const awardedBCB=wps.filter(w=>w.award_status==='Awarded').reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
    const na=wps.filter(w=>w.award_status!=='Awarded');
    const dueBCB=na.filter(w=>w.awarding_date&&new Date(w.awarding_date)<today).reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
    const notDueBCB=na.filter(w=>!w.awarding_date||new Date(w.awarding_date)>=today).reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
    const totalBCB=awardedBCB+dueBCB+notDueBCB;
    const fmt=v=>totalBCB?_mAbbr(v/1e6):'0';
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return (tot ? Math.round(v/tot*100) : 0) + '%';
    });
    make(id,{type:'doughnut',data:{labels:['Awarded','Due but Not Awarded','Not Due'],datasets:[{data:[awardedBCB,dueBCB,notDueBCB],backgroundColor:['#EE3124','#282C28','#DCDBDB'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},tooltip:{callbacks:{label:ctx=>` ${ctx.label}: ₱${fmt(ctx.raw)} (${totalBCB?((ctx.raw/totalBCB)*100).toFixed(1):'0'}%)`}},datalabels:dl}}});
  }

  // Work Package by Submittal Status — donut
  function wpSubmittalDonut(id, wps){
    const approved=wps.filter(w=>w.review_status==='approved').length;
    const pending=wps.filter(w=>w.review_status==='pending_review').length;
    const rejected=wps.filter(w=>w.review_status==='rejected').length;
    const noDraft=wps.filter(w=>!w.review_status).length;
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return v + '\n' + (tot ? Math.round(v/tot*100) : 0) + '%';
    });
    // Brand red marks the terminal milestone (Approved); Submitted = in-progress neutral dark/gray
    make(id,{type:'doughnut',data:{labels:['Submitted','Approved','Rejected','Draft'],datasets:[{data:[pending,approved,rejected,noDraft],backgroundColor:['#282C28','#EE3124','#DCDBDB','#D97706'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},datalabels:dl}}});
  }

  // Work Package by Period — quarterly bar + cumulative line
  function wpByPeriodQuarterly(id, wps){
    const qSet=new Set();
    wps.forEach(w=>{ if(w.awarding_date) qSet.add(getQKey(new Date(w.awarding_date))); });
    _extendForecastAxis(qSet, wps, 'q', false);
    if(!qSet.size){ destroy(id); return; }
    const quarters=[...qSet].sort();
    const labels=quarters.map(qLabel);
    const planned=quarters.map(qk=>wps.filter(w=>w.awarding_date&&getQKey(new Date(w.awarding_date))===qk).length);
    const actual=quarters.map(qk=>wps.filter(w=>{const ad=_actAwDate(w);return ad&&getQKey(ad)===qk;}).length);
    let cp=0,ca=0;
    const cumP=planned.map(v=>(cp+=v));
    const cumA=actual.map(v=>(ca+=v));
    const _nowQK=getQKey(new Date());
    const cumADisp=quarters.map((qk,i)=> qk>_nowQK ? null : cumA[i]);   // Cumulative Actual stops at today
    const dl = _dlBar(v => v > 0 ? v : '', 'v');
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Planned',data:planned,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Actual',data:actual,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Planned',data:cumP,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Actual',data:cumADisp,type:'line',borderColor:'#EE3124',borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1,spanGaps:false},
      {label:'Forecast',data:_wpForecastLine(quarters,getQKey,wps,cumA,()=>1,w=>!!_actAwDate(w)),type:'line',borderColor:'#EE3124',borderDash:[6,4],borderWidth:2,pointRadius:0,fill:false,tension:.1,order:1,spanGaps:false},
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:_pad('v')},plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{ticks:{font:{size:9},stepSize:1},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'Count',font:{size:9}}}}}});
  }

  // Work Package by Aging — stacked horizontal bar (single bar, 4 buckets)
  function wpAgingBuckets(id, wps, projectName){
    const today=new Date();
    const na=wps.filter(w=>w.award_status!=='Awarded'&&w.awarding_date);
    const aging=na.map(w=>Math.round((today-new Date(w.awarding_date))/86400000));
    const b1=aging.filter(a=>a>60).length;
    const b2=aging.filter(a=>a>30&&a<=60).length;
    const b3=aging.filter(a=>a>=0&&a<=30).length;
    const b4=aging.filter(a=>a<0).length;
    const proj=projectName||'Project';
    // Aging buckets are WP COUNTS, not money — show the plain integer (no "M"/"B" suffix).
    const dl = _dlStacked(v => v > 0 ? String(Math.round(v)) : '');
    make(id,{type:'bar',data:{labels:[proj],datasets:[
      {label:'>60d overdue',data:[b1],backgroundColor:'#EE3124',borderRadius:3},
      {label:'30–60d overdue',data:[b2],backgroundColor:'#D97706',borderRadius:3},
      {label:'0–30d (current)',data:[b3],backgroundColor:'#282C28',borderRadius:3},
      {label:'Future',data:[b4],backgroundColor:'#DCDBDB',borderRadius:3},
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}},datalabels:dl},scales:{x:{stacked:true,ticks:{font:{size:9},stepSize:1},grid:{color:'rgba(0,0,0,.05)'}},y:{stacked:true,grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  // Budget (BCB) and Awarded by Trade — horizontal grouped bar
  function budgetByTradeHBar(id, wps){
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))];
    const data=trades.map(t=>({t,budget:wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6,awarded:wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6})).sort((a,b)=>b.budget-a.budget);
    const dl = _dlBar(v => v > 0 ? _mAbbr(v) : '', 'h');
    make(id,{type:'bar',data:{labels:data.map(d=>d.t),datasets:[
      {label:'Budget (BCB)',data:data.map(d=>+d.budget.toFixed(1)),backgroundColor:'#282C28',borderRadius:3},
      {label:'Awarded',data:data.map(d=>+d.awarded.toFixed(1)),backgroundColor:'#EE3124',borderRadius:3},
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:_pad('h')},plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},datalabels:dl},scales:{x:{ticks:{font:{size:9},callback:_axM},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  // Budget (BCB) by Period per Trade — stacked bar (many trades × periods: labels off)
  function budgetByPeriodPerTrade(id, wps){
    const qSet=new Set();
    wps.forEach(w=>{ if(w.awarding_date) qSet.add(getQKey(new Date(w.awarding_date))); });
    if(!qSet.size){ destroy(id); return; }
    const quarters=[...qSet].sort();
    const labels=quarters.map(qLabel);
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))].sort();
    const COLORS=['#EE3124','#2D9B6F','#2563EB','#D97706','#7C3AED','#0EA5E9','#DB2777','#65A30D','#EA580C','#0D9488','#9333EA','#CA8A04','#DC2626','#16A34A','#4F46E5','#F59E0B','#BE185D','#0891B2','#84CC16','#92400E'];
    const datasets=trades.map((t,i)=>({
      label:t,
      data:quarters.map(qk=>+(wps.filter(w=>w.trade===t&&w.awarding_date&&getQKey(new Date(w.awarding_date))===qk).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6).toFixed(1)),
      backgroundColor:COLORS[i%COLORS.length],
      borderRadius:2,stack:'bgt'
    }));
    make(id,{type:'bar',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9},boxWidth:10,padding:6}},datalabels:{display:false}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:9}}},y:{stacked:true,ticks:{font:{size:9},callback:_axM},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}}}});
  }

  // Budget (BCB) by Trade — donut
  function budgetByTradeDonut(id, wps){
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))].sort();
    const COLORS=['#EE3124','#2D9B6F','#2563EB','#D97706','#7C3AED','#0EA5E9','#DB2777','#65A30D','#EA580C','#0D9488','#9333EA','#CA8A04','#DC2626','#16A34A','#4F46E5','#F59E0B','#BE185D','#0891B2','#84CC16','#92400E'];
    const vals=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6).toFixed(1));
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return _mAbbr(v)+'\n'+(tot ? Math.round(v/tot*100) : 0)+'%';
    });
    make(id,{type:'doughnut',data:{labels:trades,datasets:[{data:vals,backgroundColor:COLORS,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{font:{size:9},boxWidth:10}},datalabels:dl}}});
  }

  // Budget (BCB) and Awarded by Project — vertical grouped bar
  function budgetAwardedByProject(id, wps, projects){
    const labels=projects.map(p=>p.id);
    const budgets=projects.map(p=>wps.filter(w=>w.project_id===p.id).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6);
    const awarded=projects.map(p=>wps.filter(w=>w.project_id===p.id).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6);
    const dl = _dlBar(v => v > 0 ? _mAbbr(v) : '', 'v');
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Budget (BCB)',data:budgets,backgroundColor:'#282C28',borderRadius:3},
      {label:'Awarded',data:awarded,backgroundColor:'#EE3124',borderRadius:3},
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:_pad('v')},
      plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}},datalabels:dl},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9}}},
        y:{ticks:{font:{size:9},callback:_axM},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}
      }
    }});
  }

  // Awarded by Trade — donut
  function awardedByTradeDonut(id, wps){
    const trades=[...new Set(wps.filter(w=>w.total_awarded>0).map(w=>w.trade).filter(Boolean))].sort();
    const COLORS=['#EE3124','#2D9B6F','#2563EB','#D97706','#7C3AED','#0EA5E9','#DB2777','#65A30D','#EA580C','#0D9488','#9333EA','#CA8A04','#DC2626','#16A34A','#4F46E5','#F59E0B','#BE185D','#0891B2','#84CC16','#92400E'];
    const vals=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6).toFixed(1));
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return _mAbbr(v)+'\n'+(tot ? Math.round(v/tot*100) : 0)+'%';
    });
    make(id,{type:'doughnut',data:{labels:trades,datasets:[{data:vals,backgroundColor:COLORS,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{font:{size:9},boxWidth:10}},datalabels:dl}}});
  }

  // WP Count by Period — Monthly (Planned vs Actual)
  // ── Forecast (dashed) continuation for Planned-vs-Actual cumulative WP-count charts ──
  // Projects the not-yet-awarded WPs forward so the red Actual line continues as a dashed
  // "Forecast" line up to 100% of WPs. Forecast award/completion month per WP:
  //   • already Awarded            → its actual award month (part of Actual, not Forecast)
  //   • not awarded, planned in FUTURE (awarding_date ≥ today) → its PLANNED award month (on-schedule)
  //   • not awarded & OVERDUE (planned date < today) or no planned date → the NEXT period after today
  //     (the overdue backlog is assumed to be cleared starting the upcoming period)
  // Returns an array aligned to `keys`: null before the current period, then the cumulative
  // forecast anchored to the current Actual total so the dashed line joins the solid one seamlessly.
  // `valFn(w)` is the amount each not-yet-awarded WP contributes (default 1 → counts; pass a budget
  // function for the ₱ Budget-vs-Awarded charts so the forecast climbs toward total BCB).
  // awardedFn: predicate for "already counted in the Actual/Awarded cumulative line" — MUST match the
  // chart's actual series or the forecast double-counts (its cost in the anchor + its budget added again),
  // which pushed the dashed forecast ABOVE the cumulative budget. Budget charts count by total_awarded>0;
  // count charts count by actual award date. Default = award_status==='Awarded'.
  function _wpForecastLine(keys, keyOf, wps, cumActual, valFn, awardedFn) {
    if (!keys.length) return [];
    const val = valFn || (() => 1);
    const isAwd = awardedFn || (w => w.award_status === 'Awarded');
    const now = new Date();
    const nowKey = keyOf(now);
    let nowIdx = keys.findIndex(k => k >= nowKey);
    if (nowIdx < 0) nowIdx = keys.length - 1;
    const futureIdx = Math.min(nowIdx + 1, keys.length - 1);
    const anchor = cumActual[nowIdx] || 0;
    const add = new Array(keys.length).fill(0);
    wps.forEach(w => {
      if (isAwd(w)) return;
      let idx = futureIdx;                                   // overdue / no plan → next period
      const pa = w.awarding_date ? new Date(w.awarding_date) : null;
      if (pa && pa >= now) { let pi = keys.findIndex(k => k >= keyOf(pa)); if (pi < 0) pi = keys.length - 1; idx = Math.max(pi, futureIdx); }
      add[idx] += val(w);
    });
    const out = new Array(keys.length).fill(null);
    let run = anchor;
    for (let i = nowIdx; i < keys.length; i++) { if (i > nowIdx) run = +(run + add[i]).toFixed(1); out[i] = run; }
    return out;
  }
  const _fcDash = { borderDash: [6, 4] };

  // Ensure the period axis reaches the current + next period when a backlog exists, so the Forecast
  // line has somewhere to climb (otherwise, for projects whose WP dates are all in the past, the
  // forecast collapses to a single anchor point and the dashed line/awarded tail are invisible).
  // mode: 'm' monthly / 'q' quarterly. Skipped when hideAwd (backlog charts have no forecast).
  function _extendForecastAxis(set, wps, mode, hideAwd) {
    if (hideAwd) return;
    if (!wps.some(w => w.award_status !== 'Awarded')) return;   // nothing to forecast
    const now = new Date();
    if (mode === 'q') {
      set.add(getQKey(now));
      set.add(getQKey(new Date(now.getFullYear(), now.getMonth() + 3, 1)));
    } else {
      const k = d => d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0');
      set.add(k(now));
      set.add(k(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
    }
  }

  function wpCountByPeriodMonthly(id, wps) {
    const mSet=new Set();
    wps.forEach(w=>{
      if(w.awarding_date){const d=new Date(w.awarding_date);mSet.add(d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0'));}
      const ad=_actAwDate(w); if(ad){mSet.add(ad.getFullYear()+'-'+(ad.getMonth()+1).toString().padStart(2,'0'));}
    });
    _extendForecastAxis(mSet, wps, 'm', false);
    if(!mSet.size){destroy(id);return;}
    const months=[...mSet].sort();
    const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mLabel=k=>{const[y,m]=k.split('-');return MONTH_NAMES[parseInt(m)-1]+'\''+y.slice(2);};
    const getMKey=d=>d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0');
    const planned=months.map(mk=>wps.filter(w=>w.awarding_date&&getMKey(new Date(w.awarding_date))===mk).length);
    const actual=months.map(mk=>wps.filter(w=>{const ad=_actAwDate(w);return ad&&getMKey(ad)===mk;}).length);
    let cp=0,ca=0;
    const cumP=planned.map(v=>(cp+=v,cp));
    const cumA=actual.map(v=>(ca+=v,ca));
    // Cumulative Actual stops at today — null future periods so it doesn't run flat into the future.
    const _nowMK=getMKey(new Date());
    const cumADisp=months.map((mk,i)=> mk>_nowMK ? null : cumA[i]);
    const mob=_mob();
    const dl=mob?{display:false}:_dlBar(v=>v>0?v:'','v');
    make(id,{type:'bar',data:{labels:months.map(mLabel),datasets:[
      {label:'Planned WPs',data:planned,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Actual WPs',data:actual,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Planned',data:cumP,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:mob?1:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Actual',data:cumADisp,type:'line',borderColor:'#EE3124',borderWidth:2,pointRadius:mob?1:2,fill:false,tension:.1,order:1,spanGaps:false},
      {label:'Forecast',data:_wpForecastLine(months,getMKey,wps,cumA,()=>1,w=>!!_actAwDate(w)),type:'line',borderColor:'#EE3124',borderDash:[6,4],borderWidth:2,pointRadius:0,fill:false,tension:.1,order:1,spanGaps:false},
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:mob?0:_pad('v')},plugins:{legend:{position:'bottom',labels:{font:{size:mob?8:10},boxWidth:mob?10:12,padding:mob?5:8}},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:mob?7:9},maxRotation:45,autoSkip:true,maxTicksLimit:mob?8:24}},y:{ticks:{font:{size:mob?8:9},stepSize:1},grid:{color:'rgba(0,0,0,.05)'},title:{display:!mob,text:'No. of Work Packages',font:{size:9}}}}}});
  }

  // WP Count by Period — Quarterly (Planned vs Actual)
  function wpCountByPeriod(id, wps) {
    const qSet=new Set();
    wps.forEach(w=>{
      if(w.awarding_date) qSet.add(getQKey(new Date(w.awarding_date)));
      const ad=_actAwDate(w); if(ad) qSet.add(getQKey(ad));
    });
    _extendForecastAxis(qSet, wps, 'q', false);
    if(!qSet.size){destroy(id);return;}
    const quarters=[...qSet].sort();
    const planned=quarters.map(qk=>wps.filter(w=>w.awarding_date&&getQKey(new Date(w.awarding_date))===qk).length);
    const actual=quarters.map(qk=>wps.filter(w=>{const ad=_actAwDate(w);return ad&&getQKey(ad)===qk;}).length);
    let cp=0,ca=0;
    const cumP=planned.map(v=>(cp+=v,cp));
    const cumA=actual.map(v=>(ca+=v,ca));
    // Cumulative Actual stops at today — null future quarters so it doesn't run flat into the future.
    const _nowQK=getQKey(new Date());
    const cumADisp=quarters.map((qk,i)=> qk>_nowQK ? null : cumA[i]);
    const mob=_mob();
    const dl=mob?{display:false}:_dlBar(v=>v>0?v:'','v');
    make(id,{type:'bar',data:{labels:quarters.map(qLabel),datasets:[
      {label:'Planned WPs',data:planned,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Actual WPs',data:actual,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Planned',data:cumP,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:mob?1:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Actual',data:cumADisp,type:'line',borderColor:'#EE3124',borderWidth:2,pointRadius:mob?1:2,fill:false,tension:.1,order:1,spanGaps:false},
      {label:'Forecast',data:_wpForecastLine(quarters,getQKey,wps,cumA,()=>1,w=>!!_actAwDate(w)),type:'line',borderColor:'#EE3124',borderDash:[6,4],borderWidth:2,pointRadius:0,fill:false,tension:.1,order:1,spanGaps:false},
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:mob?0:_pad('v')},plugins:{legend:{position:'bottom',labels:{font:{size:mob?8:10},boxWidth:mob?10:12,padding:mob?5:8}},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:mob?7:9},maxRotation:45,autoSkip:true}},y:{ticks:{font:{size:mob?8:9},stepSize:1},grid:{color:'rgba(0,0,0,.05)'},title:{display:!mob,text:'No. of Work Packages',font:{size:9}}}}}});
  }

  // Procurement S-curve (project Overview): cumulative WP count by month.
  // Planned = WPs whose Planned Award Date (awarding_date) is on/before each month-end.
  // Actual  = Awarded WPs whose Actual Award Date is on/before each month-end; the actual
  // line stops at the current month (no future projection). Mirrors the Excel S-Curve sheet —
  // updates automatically as WPs are marked Awarded with an actual award date.
  function sCurve(id, wps) {
    // Parse a date value as LOCAL midnight, robust to every format the DB may return:
    // date-only 'YYYY-MM-DD', full ISO timestamps ('...T00:00:00+00:00' / '...Z'),
    // space-separated timestamps, and Date objects. We extract just the YYYY-MM-DD prefix
    // and build a local Date — this both avoids the UTC-midnight off-by-one (new Date('2026-06-30')
    // is June 29 evening in UTC+8, pushing month-end comparisons into the wrong bucket) AND avoids
    // returning null for timestamp-typed columns (which previously hid the entire curve).
    const pd = v => {
      if (!v) return null;
      if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
      const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m) return new Date(+m[1], +m[2]-1, +m[3]);
      const d = new Date(v); return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    };
    const dates = [];
    wps.forEach(w => { const d1=pd(w.awarding_date),d2=pd(w.actual_awarding_date); if(d1)dates.push(d1); if(d2)dates.push(d2); });
    const valid = dates.filter(Boolean);
    const canvasEl = document.getElementById(id);
    const wrap = canvasEl && canvasEl.parentElement;
    if (!valid.length) {
      destroy(id);
      if (wrap) {
        let msg = wrap.querySelector('.scurve-nodata');
        if (!msg) { msg = document.createElement('div'); msg.className='scurve-nodata'; msg.style.cssText='display:flex;align-items:center;justify-content:center;height:100%;color:#bbb;font-size:12px;font-style:italic;text-align:center;padding:0 16px'; wrap.appendChild(msg); }
        msg.textContent = 'No planned award dates found. Set Planned Award Dates on work packages to display the S-Curve.';
        if (canvasEl) canvasEl.style.display = 'none';
      }
      return;
    }
    // Clear any previous no-data placeholder and restore canvas visibility
    if (wrap) { const msg=wrap.querySelector('.scurve-nodata'); if(msg)msg.remove(); }
    if (canvasEl) canvasEl.style.display = '';
    const min = new Date(Math.min(...valid)), max = new Date(Math.max(...valid));
    const months = [];
    let d = new Date(min.getFullYear(), min.getMonth(), 1);
    const last = new Date(max.getFullYear(), max.getMonth(), 1);
    while (d <= last && months.length < 240) {
      months.push(new Date(d.getFullYear(), d.getMonth() + 1, 0));   // month-end (local time)
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    const now = new Date();
    const total = wps.length;
    // Actual award date falls back to the PLANNED award date when actual_awarding_date is not
    // captured (the WP-Monitoring imports populate award_status + total_awarded from the Remarks
    // column but never an actual award date — so without this fallback the Actual line is flat/empty
    // for every imported project).
    // Award date for the Actual line is CLAMPED to today — an awarded WP can never be awarded in the
    // future, so a planned-date fallback beyond today is pulled back to now (it then shows at the
    // current month instead of vanishing past the now-cutoff).
    const awd = w => { let dd=pd(w.actual_awarding_date)||pd(w.awarding_date); if(dd && dd>now) dd=new Date(now.getFullYear(),now.getMonth(),now.getDate()); return dd; };
    const planned = months.map(me => wps.filter(w => { const dd=pd(w.awarding_date); return dd && dd<=me; }).length);
    const actual  = months.map(me => { if(me>now) return null; return wps.filter(w => { const dd=awd(w); return w.award_status==='Awarded' && dd && dd<=me; }).length; });
    // Forecast (dashed, same red): continue the Actual line by projecting the not-yet-awarded WPs.
    // Forecast award/completion date per not-awarded WP: PLANNED award date if still in the future
    // (on-schedule); the NEXT month if OVERDUE (planned date already past) or no planned date —
    // i.e. the backlog is assumed to be cleared starting next period. Anchored to the last Actual
    // point so the dashed line joins the solid one and climbs toward 100% of WPs.
    let lastActualIdx = -1; for (let i=0;i<actual.length;i++){ if(actual[i]!=null) lastActualIdx=i; }
    const forecast = months.map(()=>null);
    if (lastActualIdx >= 0) {
      const anchor = actual[lastActualIdx];
      const nextME = months[Math.min(lastActualIdx+1, months.length-1)];
      const fdate = w => { const pa=pd(w.awarding_date); return (pa && pa>now) ? pa : nextME; };
      for (let i=lastActualIdx;i<months.length;i++){ const me=months[i]; forecast[i]=anchor + wps.filter(w=>w.award_status!=='Awarded' && fdate(w)<=me).length; }
    }
    const labels = months.map(me => me.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
    const mob = _mob();
    make(id, { type:'line', data:{ labels, datasets:[
      { label:'Cumulative Planned', data:planned, borderColor:'#282C28', backgroundColor:'rgba(40,44,40,0.06)', fill:true, tension:.3, pointRadius:mob?0:2, borderWidth:2, order:2 },
      { label:'Cumulative Actual (Awarded)', data:actual, borderColor:'#EE3124', backgroundColor:'rgba(238,49,36,0.07)', fill:true, tension:.3, pointRadius:mob?0:2, borderWidth:2, spanGaps:false, order:1 },
      { label:'Forecast', data:forecast, borderColor:'#EE3124', borderDash:[6,4], fill:false, tension:.3, pointRadius:0, borderWidth:2, spanGaps:false, order:1 },
    ]}, options:{ responsive:true, maintainAspectRatio:false, interaction:{ intersect:false, mode:'index' }, plugins:{ legend:{ position:'bottom', labels:{ font:{ size:mob?8:10 }, boxWidth:mob?10:12 } }, datalabels:{ display:false }, tooltip:{ callbacks:{ label:ctx=>` ${ctx.dataset.label}: ${ctx.raw==null?'—':ctx.raw} / ${total} WP` } } }, scales:{ x:{ grid:{ display:false }, ticks:{ font:{ size:mob?7:9 }, maxRotation:45, autoSkip:true, maxTicksLimit:mob?8:18 } }, y:{ beginAtZero:true, suggestedMax:total, ticks:{ font:{ size:mob?8:9 }, stepSize:1, precision:0 }, grid:{ color:'rgba(0,0,0,.05)' }, title:{ display:!mob, text:'Cumulative WPs', font:{ size:9 } } } } } });
  }

  return {statusByZone,awardingLeadTime,budgetVsContract,varianceTrend,scheduleTimeline,awardDonut,consolidatedBudget,budgetByTrade,awardRateByTrade,budgetAwardedByPeriod,budgetAwardedByPeriodMonthly,wpByTrade,wpStatusDonut,wpStatusDonutValue,wpSubmittalDonut,wpByPeriodQuarterly,wpAgingBuckets,budgetByTradeHBar,budgetByPeriodPerTrade,budgetByTradeDonut,awardedByTradeDonut,budgetAwardedByProject,wpCountByPeriodMonthly,wpCountByPeriod,sCurve,expand,collapse,updateTheme};
})();
