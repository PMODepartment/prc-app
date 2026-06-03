const Charts = (() => {
  const reg = {};

  // Register datalabels plugin globally; default off — each chart opts in explicitly
  if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
    Chart.defaults.plugins.datalabels = { display: false };
  }

  function destroy(id) { if(reg[id]){reg[id].destroy();delete reg[id];} }
  function make(id,cfg) {
    destroy(id);
    const ctx=document.getElementById(id);
    if(!ctx)return;
    // Save datalabels display fn, then hide by default — shown only when card is expanded
    const dlPlugin = cfg.options?.plugins?.datalabels;
    let savedDisplay = null;
    if (dlPlugin && dlPlugin.display !== false) {
      savedDisplay = dlPlugin.display !== undefined ? dlPlugin.display : true;
      cfg.options.plugins.datalabels = { ...dlPlugin, display: false };
    }
    const chart = new Chart(ctx.getContext('2d'),cfg);
    reg[id] = chart;
    if (savedDisplay !== null) chart._dlDisplay = savedDisplay;
    return chart;
  }

  // Called by initExpandableCharts() in ui.js when a chart panel is expanded/collapsed
  function expand(id) {
    const chart = reg[id];
    if (!chart || !chart._dlDisplay) return;
    chart.options.plugins.datalabels.display = chart._dlDisplay;
    chart.update('none');
  }
  function collapse(id) {
    const chart = reg[id];
    if (!chart || !chart._dlDisplay) return;
    chart.options.plugins.datalabels.display = false;
    chart.update('none');
  }

  // ── Data label helpers ───────────────────────────────────────
  function _mob() { return window.innerWidth < 640; }

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
      color: '#231F20',
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

  // ── Chart functions ──────────────────────────────────────────

  function statusByZone(id,wps){
    const zones=[...new Set(wps.map(w=>w.zone))].filter(Boolean);
    make(id,{type:'bar',data:{labels:zones,datasets:[
      {label:'Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status==='Awarded').length),backgroundColor:'#2D9B6F',borderRadius:4},
      {label:'Partially Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status==='Partially Awarded').length),backgroundColor:'#D97706',borderRadius:4},
      {label:'Not Yet Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status!=='Awarded'&&w.award_status!=='Partially Awarded').length),backgroundColor:'#DCDBDB',borderRadius:4}
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
    make(id,{type:'doughnut',data:{labels:['Awarded','Partial','Not Yet'],datasets:[{data:[stats.awarded,stats.partial,stats.notAwarded],backgroundColor:['#2D9B6F','#D97706','#DCDBDB'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false},datalabels:dl}}});
  }

  function consolidatedBudget(id,projects,allStats){
    const dl = _dlBar(v => v > 0 ? v.toFixed(1)+'M' : '', 'v');
    make(id,{type:'bar',data:{labels:projects.map(p=>p.id),datasets:[
      {label:'Budget',data:allStats.map(s=>+((s.totalBudget||0)/1e6).toFixed(1)),backgroundColor:'rgba(40,44,40,0.55)',borderRadius:4},
      {label:'Awarded',data:allStats.map(s=>+((s.totalContract||0)/1e6).toFixed(1)),backgroundColor:'rgba(45,155,111,0.75)',borderRadius:4}
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:_pad('v')},plugins:{legend:{display:false},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function budgetByTrade(id,wps,trades){
    const data=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6).toFixed(1));
    const awardedData=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6).toFixed(1));
    const dl = _dlBar(v => v > 0 ? v.toFixed(1)+'M' : '', 'h');
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

  // Budget (BCB) and Awarded by Period — MONTHLY combo chart
  function budgetAwardedByPeriodMonthly(id, wps){
    const mSet=new Set();
    wps.forEach(w=>{ if(w.awarding_date){ const d=new Date(w.awarding_date); mSet.add(d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0')); } });
    if(!mSet.size){ destroy(id); return; }
    const months=[...mSet].sort();
    const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mLabel=k=>{ const[y,m]=k.split('-'); return MONTH_NAMES[parseInt(m)-1]+' \''+y.slice(2); };
    const getMKey=d=>d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0');
    const budgetData=months.map(mk=>wps.filter(w=>w.awarding_date&&getMKey(new Date(w.awarding_date))===mk).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6);
    const awardedData=months.map(mk=>wps.filter(w=>w.actual_awarding_date&&getMKey(new Date(w.actual_awarding_date))===mk).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6);
    let cb=0,ca=0;
    const cumB=budgetData.map(v=>(cb=+(cb+v).toFixed(1)));
    const cumA=awardedData.map(v=>(ca=+(ca+v).toFixed(1)));
    const dl = _dlBar(v => v > 0 ? v.toFixed(1)+'M' : '', 'v');
    make(id,{type:'bar',data:{labels:months.map(mLabel),datasets:[
      {label:'Budget (BCB)',data:budgetData,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Awarded',data:awardedData,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Budget',data:cumB,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Awarded',data:cumA,type:'line',borderColor:'#EE3124',borderDash:[5,3],borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:_pad('v')},plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:9},maxRotation:45,autoSkip:true}},y:{ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}}}});
  }

  // Budget (BCB) and Awarded by Period — quarterly combo chart
  function budgetAwardedByPeriod(id, wps){
    const qSet=new Set();
    wps.forEach(w=>{ if(w.awarding_date) qSet.add(getQKey(new Date(w.awarding_date))); });
    if(!qSet.size){ destroy(id); return; }
    const quarters=[...qSet].sort();
    const labels=quarters.map(qLabel);
    const budgetData=quarters.map(qk=>wps.filter(w=>w.awarding_date&&getQKey(new Date(w.awarding_date))===qk).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6);
    const awardedData=quarters.map(qk=>wps.filter(w=>w.actual_awarding_date&&getQKey(new Date(w.actual_awarding_date))===qk).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6);
    let cb=0,ca=0;
    const cumB=budgetData.map(v=>(cb=+(cb+v).toFixed(1)));
    const cumA=awardedData.map(v=>(ca=+(ca+v).toFixed(1)));
    const dl = _dlBar(v => v > 0 ? v.toFixed(1)+'M' : '', 'v');
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Budget (BCB)',data:budgetData,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Awarded',data:awardedData,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Budget',data:cumB,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Awarded',data:cumA,type:'line',borderColor:'#EE3124',borderDash:[5,3],borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:_pad('v')},plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}},datalabels:dl},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}}}});
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
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return v + '\n' + (tot ? Math.round(v/tot*100) : 0) + '%';
    });
    make(id,{type:'doughnut',data:{labels:['Awarded','Due but Not Awarded','Not Due'],datasets:[{data:[awarded,due,notDue],backgroundColor:['#EE3124','#282C28','#DCDBDB'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},tooltip:{callbacks:{label:ctx=>` ${ctx.label}: ${ctx.raw} (${total?((ctx.raw/total)*100).toFixed(1):'0'}%)`}},datalabels:dl}}});
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
    make(id,{type:'doughnut',data:{labels:['Submitted','Approved','Rejected','Draft'],datasets:[{data:[pending,approved,rejected,noDraft],backgroundColor:['#EE3124','#282C28','#DCDBDB','#D97706'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},datalabels:dl}}});
  }

  // Work Package by Period — quarterly bar + cumulative line
  function wpByPeriodQuarterly(id, wps){
    const qSet=new Set();
    wps.forEach(w=>{ if(w.awarding_date) qSet.add(getQKey(new Date(w.awarding_date))); });
    if(!qSet.size){ destroy(id); return; }
    const quarters=[...qSet].sort();
    const labels=quarters.map(qLabel);
    const planned=quarters.map(qk=>wps.filter(w=>w.awarding_date&&getQKey(new Date(w.awarding_date))===qk).length);
    const actual=quarters.map(qk=>wps.filter(w=>w.actual_awarding_date&&getQKey(new Date(w.actual_awarding_date))===qk).length);
    let cp=0,ca=0;
    const cumP=planned.map(v=>(cp+=v));
    const cumA=actual.map(v=>(ca+=v));
    const dl = _dlBar(v => v > 0 ? v : '', 'v');
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Planned',data:planned,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Actual',data:actual,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Planned',data:cumP,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Actual',data:cumA,type:'line',borderColor:'#EE3124',borderDash:[5,3],borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
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
    const dl = _dlStacked(v => v > 0 ? v : '');
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
    const dl = _dlBar(v => v > 0 ? v.toFixed(1)+'M' : '', 'h');
    make(id,{type:'bar',data:{labels:data.map(d=>d.t),datasets:[
      {label:'Budget (BCB)',data:data.map(d=>+d.budget.toFixed(1)),backgroundColor:'#282C28',borderRadius:3},
      {label:'Awarded',data:data.map(d=>+d.awarded.toFixed(1)),backgroundColor:'#EE3124',borderRadius:3},
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:_pad('h')},plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},datalabels:dl},scales:{x:{ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  // Budget (BCB) by Period per Trade — stacked bar (many trades × periods: labels off)
  function budgetByPeriodPerTrade(id, wps){
    const qSet=new Set();
    wps.forEach(w=>{ if(w.awarding_date) qSet.add(getQKey(new Date(w.awarding_date))); });
    if(!qSet.size){ destroy(id); return; }
    const quarters=[...qSet].sort();
    const labels=quarters.map(qLabel);
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))].sort();
    const COLORS=['#EE3124','#282C28','#2D9B6F','#D97706','#DCDBDB','#5A5858','#C42127','#3B6D11','#92400E','#6B7280'];
    const datasets=trades.map((t,i)=>({
      label:t,
      data:quarters.map(qk=>+(wps.filter(w=>w.trade===t&&w.awarding_date&&getQKey(new Date(w.awarding_date))===qk).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6).toFixed(1)),
      backgroundColor:COLORS[i%COLORS.length],
      borderRadius:2,stack:'bgt'
    }));
    make(id,{type:'bar',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9},boxWidth:10,padding:6}},datalabels:{display:false}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:9}}},y:{stacked:true,ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}}}});
  }

  // Budget (BCB) by Trade — donut
  function budgetByTradeDonut(id, wps){
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))].sort();
    const COLORS=['#EE3124','#282C28','#2D9B6F','#D97706','#DCDBDB','#5A5858','#C42127','#3B6D11','#92400E','#6B7280'];
    const vals=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6).toFixed(1));
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return v.toFixed(1)+'M\n'+(tot ? Math.round(v/tot*100) : 0)+'%';
    });
    make(id,{type:'doughnut',data:{labels:trades,datasets:[{data:vals,backgroundColor:COLORS,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{font:{size:9},boxWidth:10}},datalabels:dl}}});
  }

  // Budget (BCB) and Awarded by Project — vertical grouped bar
  function budgetAwardedByProject(id, wps, projects){
    const labels=projects.map(p=>p.id);
    const budgets=projects.map(p=>wps.filter(w=>w.project_id===p.id).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6);
    const awarded=projects.map(p=>wps.filter(w=>w.project_id===p.id).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6);
    const dl = _dlBar(v => v > 0 ? v.toFixed(1)+'M' : '', 'v');
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Budget (BCB)',data:budgets,backgroundColor:'#282C28',borderRadius:3},
      {label:'Awarded',data:awarded,backgroundColor:'#EE3124',borderRadius:3},
    ]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:_pad('v')},
      plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}},datalabels:dl},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9}}},
        y:{ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}
      }
    }});
  }

  // Awarded by Trade — donut
  function awardedByTradeDonut(id, wps){
    const trades=[...new Set(wps.filter(w=>w.total_awarded>0).map(w=>w.trade).filter(Boolean))].sort();
    const COLORS=['#EE3124','#282C28','#2D9B6F','#D97706','#DCDBDB','#5A5858','#C42127','#3B6D11','#92400E','#6B7280'];
    const vals=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6).toFixed(1));
    const dl = _dlDonut((v,ctx) => {
      const tot = ctx.dataset.data.reduce((a,b)=>a+(b||0),0);
      return v.toFixed(1)+'M\n'+(tot ? Math.round(v/tot*100) : 0)+'%';
    });
    make(id,{type:'doughnut',data:{labels:trades,datasets:[{data:vals,backgroundColor:COLORS,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{font:{size:9},boxWidth:10}},datalabels:dl}}});
  }

  return {statusByZone,awardingLeadTime,budgetVsContract,varianceTrend,scheduleTimeline,awardDonut,consolidatedBudget,budgetByTrade,awardRateByTrade,budgetAwardedByPeriod,budgetAwardedByPeriodMonthly,wpByTrade,wpStatusDonut,wpSubmittalDonut,wpByPeriodQuarterly,wpAgingBuckets,budgetByTradeHBar,budgetByPeriodPerTrade,budgetByTradeDonut,awardedByTradeDonut,budgetAwardedByProject,expand,collapse};
})();
