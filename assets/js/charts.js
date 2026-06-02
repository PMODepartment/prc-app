const Charts = (() => {
  const reg = {};
  function destroy(id) { if(reg[id]){reg[id].destroy();delete reg[id];} }
  function make(id,cfg) {
    destroy(id);
    const ctx=document.getElementById(id);
    if(!ctx)return;
    reg[id]=new Chart(ctx.getContext('2d'),cfg);
    return reg[id];
  }

  function statusByZone(id,wps){
    const zones=[...new Set(wps.map(w=>w.zone))].filter(Boolean);
    make(id,{type:'bar',data:{labels:zones,datasets:[
      {label:'Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status==='Awarded').length),backgroundColor:'#2D9B6F',borderRadius:4},
      {label:'Partially Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status==='Partially Awarded').length),backgroundColor:'#D97706',borderRadius:4},
      {label:'Not Yet Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status!=='Awarded'&&w.award_status!=='Partially Awarded').length),backgroundColor:'#DCDBDB',borderRadius:4}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:10}}},y:{stacked:true,ticks:{stepSize:1,font:{size:10}},grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function awardingLeadTime(id,wps){
    const data=wps.filter(w=>w.actual_awarding_date);
    const vals=data.map(w=>w.awarding_lead_time||0);
    make(id,{type:'bar',data:{labels:data.map(w=>w.wp_no),datasets:[{label:'Lead time',data:vals,borderRadius:3,backgroundColor:vals.map(v=>v>0?'rgba(226,75,74,0.75)':'rgba(45,155,111,0.75)')}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9},maxRotation:45,autoSkip:true}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'Days',font:{size:9}}}}}});
  }

  function budgetVsContract(id,wps){
    const data=wps.filter(w=>w.total_awarded!=null&&w.total_awarded>0);
    make(id,{type:'bar',data:{labels:data.map(w=>w.wp_no),datasets:[
      {label:'Budget',data:data.map(w=>+((w.approved_budget_bcb||0)/1e6).toFixed(2)),backgroundColor:'rgba(40,44,40,0.55)',borderRadius:3},
      {label:'Contract',data:data.map(w=>+((w.total_awarded||0)/1e6).toFixed(2)),backgroundColor:'rgba(45,155,111,0.75)',borderRadius:3}
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
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
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function scheduleTimeline(id,wps){
    const data=wps.slice(0,12);
    const toMs=d=>d?new Date(d).getTime():null;
    make(id,{type:'scatter',data:{datasets:[
      {label:'Awarding',data:data.map((w,i)=>({x:toMs(w.awarding_date),y:i})),backgroundColor:'#282C28',pointRadius:5},
      {label:'Delivery',data:data.map((w,i)=>({x:toMs(w.target_delivery),y:i})),backgroundColor:'#D97706',pointRadius:5},
      {label:'Completion',data:data.map((w,i)=>({x:toMs(w.target_completion),y:i})),backgroundColor:'#5A5858',pointRadius:5}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{type:'linear',ticks:{font:{size:9},callback:v=>new Date(v).toLocaleDateString('en-PH',{month:'short',year:'2-digit'})},grid:{color:'rgba(0,0,0,.05)'}},y:{ticks:{font:{size:9},callback:(_,i)=>data[i]?.wp_no||'',stepSize:1},min:-0.5,max:data.length-0.5,grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function awardDonut(id,stats){
    make(id,{type:'doughnut',data:{labels:['Awarded','Partial','Not Yet'],datasets:[{data:[stats.awarded,stats.partial,stats.notAwarded],backgroundColor:['#2D9B6F','#D97706','#DCDBDB'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false}}}});
  }

  function consolidatedBudget(id,projects,allStats){
    make(id,{type:'bar',data:{labels:projects.map(p=>p.id),datasets:[
      {label:'Budget',data:allStats.map(s=>+((s.totalBudget||0)/1e6).toFixed(1)),backgroundColor:'rgba(40,44,40,0.55)',borderRadius:4},
      {label:'Awarded',data:allStats.map(s=>+((s.totalContract||0)/1e6).toFixed(1)),backgroundColor:'rgba(45,155,111,0.75)',borderRadius:4}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function budgetByTrade(id,wps,trades){
    const data=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6).toFixed(1));
    const awardedData=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6).toFixed(1));
    make(id,{type:'bar',data:{labels:trades,datasets:[
      {label:'Budget',data:data,backgroundColor:'rgba(40,44,40,0.55)',borderRadius:4},
      {label:'Awarded',data:awardedData,backgroundColor:'rgba(45,155,111,0.7)',borderRadius:4}
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}}},scales:{x:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  function awardRateByTrade(id,wps,trades){
    const rates=trades.map(t=>{
      const tw=wps.filter(w=>w.trade===t);
      return tw.length?Math.round(tw.filter(w=>w.award_status==='Awarded').length/tw.length*100):0;
    });
    make(id,{type:'bar',data:{labels:trades,datasets:[{label:'Award Rate %',data:rates,backgroundColor:rates.map(r=>r>=80?'#2D9B6F':r>=50?'#D97706':'#EE3124'),borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{min:0,max:100,ticks:{font:{size:9},callback:v=>v+'%'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
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
    make(id,{type:'bar',data:{labels:months.map(mLabel),datasets:[
      {label:'Budget (BCB)',data:budgetData,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Awarded',data:awardedData,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Budget',data:cumB,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Awarded',data:cumA,type:'line',borderColor:'#EE3124',borderDash:[5,3],borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}}},scales:{x:{grid:{display:false},ticks:{font:{size:9},maxRotation:45,autoSkip:true}},y:{ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}}}});
  }

  // Budget (BCB) and Awarded by Period — quarterly combo chart (matches Power BI Projects & Budget pages)
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
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Budget (BCB)',data:budgetData,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Awarded',data:awardedData,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Budget',data:cumB,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Awarded',data:cumA,type:'line',borderColor:'#EE3124',borderDash:[5,3],borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}}},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}}}});
  }

  // Work Package by Trade — horizontal grouped bar (Total WP vs Awarded WP count)
  function wpByTrade(id, wps){
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))];
    const data=trades.map(t=>({t,total:wps.filter(w=>w.trade===t).length,awarded:wps.filter(w=>w.trade===t&&w.award_status==='Awarded').length})).sort((a,b)=>b.total-a.total);
    make(id,{type:'bar',data:{labels:data.map(d=>d.t),datasets:[
      {label:'Total WP',data:data.map(d=>d.total),backgroundColor:'#282C28',borderRadius:3},
      {label:'Awarded WP',data:data.map(d=>d.awarded),backgroundColor:'#EE3124',borderRadius:3},
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}}},scales:{x:{ticks:{font:{size:9},stepSize:1},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'Count',font:{size:9}}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  // Work Package by Status — donut (Awarded / Due but Not Awarded / Not Due)
  function wpStatusDonut(id, wps){
    const today=new Date();
    const awarded=wps.filter(w=>w.award_status==='Awarded').length;
    const na=wps.filter(w=>w.award_status!=='Awarded');
    const due=na.filter(w=>w.awarding_date&&new Date(w.awarding_date)<today).length;
    const notDue=na.filter(w=>!w.awarding_date||new Date(w.awarding_date)>=today).length;
    const total=wps.length;
    make(id,{type:'doughnut',data:{labels:['Awarded','Due but Not Awarded','Not Due'],datasets:[{data:[awarded,due,notDue],backgroundColor:['#EE3124','#282C28','#DCDBDB'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},tooltip:{callbacks:{label:ctx=>` ${ctx.label}: ${ctx.raw} (${total?((ctx.raw/total)*100).toFixed(1):'0'}%)`}}}}});
  }

  // Work Package by Submittal Status — donut (Submitted/Not Submitted/Approved)
  function wpSubmittalDonut(id, wps){
    const approved=wps.filter(w=>w.review_status==='approved').length;
    const pending=wps.filter(w=>w.review_status==='pending_review').length;
    const rejected=wps.filter(w=>w.review_status==='rejected').length;
    const noDraft=wps.filter(w=>!w.review_status).length;
    make(id,{type:'doughnut',data:{labels:['Submitted','Approved','Rejected','Draft'],datasets:[{data:[pending,approved,rejected,noDraft],backgroundColor:['#EE3124','#282C28','#DCDBDB','#D97706'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}}}}});
  }

  // Work Package by Period — quarterly bar + cumulative line (Backlog / Schedule)
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
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Planned',data:planned,backgroundColor:'#282C28',borderRadius:3,order:2},
      {label:'Actual',data:actual,backgroundColor:'#EE3124',borderRadius:3,order:2},
      {label:'Cumulative Planned',data:cumP,type:'line',borderColor:'#282C28',borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
      {label:'Cumulative Actual',data:cumA,type:'line',borderColor:'#EE3124',borderDash:[5,3],borderWidth:2,pointRadius:2,fill:false,tension:.1,order:1},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}}},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{ticks:{font:{size:9},stepSize:1},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'Count',font:{size:9}}}}}});
  }

  // Work Package by Aging per Project — stacked horizontal bar with 4 aging buckets
  function wpAgingBuckets(id, wps, projectName){
    const today=new Date();
    const na=wps.filter(w=>w.award_status!=='Awarded'&&w.awarding_date);
    const aging=na.map(w=>Math.round((today-new Date(w.awarding_date))/86400000));
    const b1=aging.filter(a=>a>60).length;
    const b2=aging.filter(a=>a>30&&a<=60).length;
    const b3=aging.filter(a=>a>=0&&a<=30).length;
    const b4=aging.filter(a=>a<0).length;
    const proj=projectName||'Project';
    make(id,{type:'bar',data:{labels:[proj],datasets:[
      {label:'>60d overdue',data:[b1],backgroundColor:'#EE3124',borderRadius:3},
      {label:'30–60d overdue',data:[b2],backgroundColor:'#D97706',borderRadius:3},
      {label:'0–30d (current)',data:[b3],backgroundColor:'#282C28',borderRadius:3},
      {label:'Future',data:[b4],backgroundColor:'#DCDBDB',borderRadius:3},
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}}},scales:{x:{stacked:true,ticks:{font:{size:9},stepSize:1},grid:{color:'rgba(0,0,0,.05)'}},y:{stacked:true,grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  // Budget (BCB) and Awarded by Trade — horizontal grouped bar with value labels
  function budgetByTradeHBar(id, wps){
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))];
    const data=trades.map(t=>({t,budget:wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6,awarded:wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6})).sort((a,b)=>b.budget-a.budget);
    make(id,{type:'bar',data:{labels:data.map(d=>d.t),datasets:[
      {label:'Budget (BCB)',data:data.map(d=>+d.budget.toFixed(1)),backgroundColor:'#282C28',borderRadius:3},
      {label:'Awarded',data:data.map(d=>+d.awarded.toFixed(1)),backgroundColor:'#EE3124',borderRadius:3},
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}},datalabels:{display:false}},scales:{x:{ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  // Budget (BCB) by Period per Trade — stacked bar chart (Works page)
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
    make(id,{type:'bar',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9},boxWidth:10,padding:6}}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:9}}},y:{stacked:true,ticks:{font:{size:9},callback:v=>v.toFixed(0)+' M'},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'₱ Million',font:{size:9}}}}}});
  }

  // Budget (BCB) by Trade — donut
  function budgetByTradeDonut(id, wps){
    const trades=[...new Set(wps.map(w=>w.trade).filter(Boolean))].sort();
    const COLORS=['#EE3124','#282C28','#2D9B6F','#D97706','#DCDBDB','#5A5858','#C42127','#3B6D11','#92400E','#6B7280'];
    const vals=trades.map(t=>+(wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6).toFixed(1));
    make(id,{type:'doughnut',data:{labels:trades,datasets:[{data:vals,backgroundColor:COLORS,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{font:{size:9},boxWidth:10}}}}});
  }

  // Budget (BCB) and Awarded by Project — grouped bar
  function budgetAwardedByProject(id, wps, projects){
    const labels=projects.map(p=>p.id);
    const budgets=projects.map(p=>wps.filter(w=>w.project_id===p.id).reduce((s,w)=>s+(w.approved_budget_bcb||0),0)/1e6);
    const awarded=projects.map(p=>wps.filter(w=>w.project_id===p.id).reduce((s,w)=>s+(w.total_awarded||0),0)/1e6);
    make(id,{type:'bar',data:{labels,datasets:[
      {label:'Budget (BCB)',data:budgets,backgroundColor:'#282C28',borderRadius:3},
      {label:'Awarded',data:awarded,backgroundColor:'#EE3124',borderRadius:3},
    ]},options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12,padding:8}}},
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
    make(id,{type:'doughnut',data:{labels:trades,datasets:[{data:vals,backgroundColor:COLORS,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{font:{size:9},boxWidth:10}}}}});
  }

  return {statusByZone,awardingLeadTime,budgetVsContract,varianceTrend,scheduleTimeline,awardDonut,consolidatedBudget,budgetByTrade,awardRateByTrade,budgetAwardedByPeriod,budgetAwardedByPeriodMonthly,wpByTrade,wpStatusDonut,wpSubmittalDonut,wpByPeriodQuarterly,wpAgingBuckets,budgetByTradeHBar,budgetByPeriodPerTrade,budgetByTradeDonut,awardedByTradeDonut,budgetAwardedByProject};
})();
