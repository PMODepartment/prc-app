const Charts = (() => {
  const reg = {};
  function destroy(id) { if(reg[id]){reg[id].destroy();delete reg[id];} }
  function make(id, cfg) {
    destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    reg[id] = new Chart(ctx.getContext('2d'), cfg);
    return reg[id];
  }

  const COLORS = ['#EE3124','#282C28','#2D9B6F','#D97706','#DCDBDB','#5A5858','#C42127','#3B6D11','#92400E','#1e40af','#7c3aed','#0891b2'];

  function statusByZone(id, wps) {
    const zones = [...new Set(wps.map(w=>w.zone))].filter(Boolean);
    make(id, {type:'bar',data:{labels:zones,datasets:[
      {label:'Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status==='Awarded').length),backgroundColor:'#2D9B6F',borderRadius:4},
      {label:'Partially Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&w.award_status==='Partially Awarded').length),backgroundColor:'#D97706',borderRadius:4},
      {label:'Not Yet Awarded',data:zones.map(z=>wps.filter(w=>w.zone===z&&!['Awarded','Partially Awarded'].includes(w.award_status)).length),backgroundColor:'#DCDBDB',borderRadius:4}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:10}}},y:{stacked:true,ticks:{stepSize:1,font:{size:10}},grid:{color:'rgba(0,0,0,.05)'}}}}});
  }

  function awardingLeadTime(id, wps) {
    const data = wps.filter(w=>w.actual_awarding_date);
    const vals = data.map(w=>w.awarding_lead_time||0);
    make(id, {type:'bar',data:{labels:data.map(w=>w.wp_no),datasets:[{label:'Lead time',data:vals,borderRadius:3,backgroundColor:vals.map(v=>v>0?'rgba(226,75,74,0.75)':'rgba(45,155,111,0.75)')}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9},maxRotation:45,autoSkip:true}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'},title:{display:true,text:'Days',font:{size:9}}}}}});
  }

  function budgetVsContract(id, wps) {
    const data = wps.filter(w=>w.total_awarded!=null&&w.total_awarded>0);
    make(id, {type:'bar',data:{labels:data.map(w=>w.wp_no),datasets:[
      {label:'Budget',data:data.map(w=>+((w.approved_budget_bcb||0)/1e6).toFixed(2)),backgroundColor:'rgba(40,44,40,0.55)',borderRadius:3},
      {label:'Contract',data:data.map(w=>+((w.total_awarded||0)/1e6).toFixed(2)),backgroundColor:'rgba(45,155,111,0.75)',borderRadius:3}
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  function varianceTrend(id, wps) {
    const awarded = wps.filter(w=>w.actual_awarding_date&&w.total_awarded!=null);
    const months = [...new Set(awarded.map(w=>w.actual_awarding_date.slice(0,7)))].sort();
    let cumSav=0, cumLoss=0;
    const savData=[], lossData=[], netData=[];
    months.forEach(m=>{
      const net = awarded.filter(w=>w.actual_awarding_date.slice(0,7)===m).reduce((s,w)=>s+(w.variance||0),0);
      if(net>=0) cumSav=+(cumSav+net).toFixed(0); else cumLoss=+(cumLoss+Math.abs(net)).toFixed(0);
      savData.push(+(cumSav/1e6).toFixed(2));
      lossData.push(+(cumLoss/1e6).toFixed(2));
      netData.push(+(net/1e6).toFixed(2));
    });
    const labels = months.map(m=>new Date(m+'-01').toLocaleDateString('en-PH',{month:'short',year:'2-digit'}));
    make(id, {type:'line',data:{labels,datasets:[
      {label:'Savings',data:savData,borderColor:'#2D9B6F',backgroundColor:'rgba(45,155,111,.08)',fill:true,tension:.35,pointRadius:3,borderWidth:2},
      {label:'Overrun',data:lossData,borderColor:'#E24B4A',borderDash:[5,3],fill:false,tension:.35,pointRadius:3,borderWidth:2},
      {label:'Monthly',data:netData,type:'bar',backgroundColor:netData.map(v=>v>=0?'rgba(40,44,40,.45)':'rgba(226,75,74,.35)'),borderRadius:2,order:2}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}}}}}); 
  }

  function scheduleTimeline(id, wps) {
    const data = wps.slice(0,12);
    const toMs = d=>d?new Date(d).getTime():null;
    make(id, {type:'scatter',data:{datasets:[
      {label:'Awarding',data:data.map((w,i)=>({x:toMs(w.awarding_date),y:i})),backgroundColor:'#282C28',pointRadius:5},
      {label:'Delivery',data:data.map((w,i)=>({x:toMs(w.target_delivery),y:i})),backgroundColor:'#D97706',pointRadius:5},
      {label:'Completion',data:data.map((w,i)=>({x:toMs(w.target_completion),y:i})),backgroundColor:'#5A5858',pointRadius:5}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{type:'linear',ticks:{font:{size:9},callback:v=>new Date(v).toLocaleDateString('en-PH',{month:'short',year:'2-digit'})},grid:{color:'rgba(0,0,0,.05)'}},y:{ticks:{font:{size:9},callback:(_,i)=>data[i]?.wp_no||'',stepSize:1},min:-0.5,max:data.length-0.5,grid:{color:'rgba(0,0,0,.05)'}}}}}); 
  }

  function awardDonut(id, stats) {
    make(id, {type:'doughnut',data:{labels:['Awarded','Partial','Not Yet'],datasets:[{data:[stats.awarded,stats.partial,stats.notAwarded],backgroundColor:['#2D9B6F','#D97706','#DCDBDB'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false}}}});
  }

  function consolidatedBudget(id, projects, allStats) {
    make(id, {type:'bar',data:{labels:projects.map(p=>p.id),datasets:[
      {label:'Budget',data:allStats.map(s=>+((s.totalBudget||0)/1e6).toFixed(1)),backgroundColor:'rgba(40,44,40,0.55)',borderRadius:4},
      {label:'Awarded',data:allStats.map(s=>+((s.totalContract||0)/1e6).toFixed(1)),backgroundColor:'rgba(45,155,111,0.75)',borderRadius:4}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}}}}}); 
  }

  function budgetByTrade(id, wps, trades) {
    if (!trades||!trades.length) return;
    const budgetData = trades.map(t=>+((wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.approved_budget_bcb||0),0))/1e6).toFixed(1));
    const awardedData = trades.map(t=>+((wps.filter(w=>w.trade===t).reduce((s,w)=>s+(w.total_awarded||0),0))/1e6).toFixed(1));
    make(id, {type:'bar',data:{labels:trades,datasets:[
      {label:'Budget BCB',data:budgetData,backgroundColor:'rgba(40,44,40,0.55)',borderRadius:4},
      {label:'Awarded',data:awardedData,backgroundColor:'rgba(45,155,111,0.7)',borderRadius:4}
    ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}}},scales:{x:{ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  function awardRateByTrade(id, wps, trades) {
    if (!trades||!trades.length) return;
    const rates = trades.map(t=>{
      const tw = wps.filter(w=>w.trade===t);
      return tw.length ? Math.round(tw.filter(w=>w.award_status==='Awarded').length/tw.length*100) : 0;
    });
    make(id, {type:'bar',data:{labels:trades,datasets:[{label:'Award Rate %',data:rates,backgroundColor:rates.map(r=>r>=80?'#2D9B6F':r>=50?'#D97706':'#EE3124'),borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{min:0,max:100,ticks:{font:{size:9},callback:v=>v+'%'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  function wpCountByTrade(id, wps, trades) {
    if (!trades||!trades.length) return;
    const counts = trades.map(t=>wps.filter(w=>w.trade===t).length);
    const awardedCounts = trades.map(t=>wps.filter(w=>w.trade===t&&w.award_status==='Awarded').length);
    make(id, {type:'doughnut',data:{labels:trades,datasets:[{data:counts,backgroundColor:COLORS,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{font:{size:10}}}}}});
  }

  return {statusByZone,awardingLeadTime,budgetVsContract,varianceTrend,scheduleTimeline,awardDonut,consolidatedBudget,budgetByTrade,awardRateByTrade,wpCountByTrade};
})();
