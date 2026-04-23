const ALPACA_KEY    = 'PKFU6MJS2V6HW3GMI4H5LVPX4Y';
const ALPACA_SECRET = '9KEdGyUZrpQzsCgP4Y5Y2nKpiJHK7KhaGv865fn2t23y';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  try {
    const [gldRes, gcRes] = await Promise.all([
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/GLD?interval=1d&range=1d'),
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d')
    ]);
    const gldData    = await gldRes.json();
    const gcData     = await gcRes.json();
    const gldPrice   = gldData.chart.result[0].meta.regularMarketPrice;
    const goldPrice  = gcData.chart.result[0].meta.regularMarketPrice;
    const multiplier = goldPrice / gldPrice;

    const expiry    = getNextFriday();
    const expiryStr = expiry.toISOString().split('T')[0];
    const daysLeft  = Math.ceil((expiry - new Date()) / (1000*60*60*24));

    const alpRes = await fetch(
      'https://data.alpaca.markets/v1beta1/options/snapshots/GLD?expiration_date=' + expiryStr + '&limit=1000',
      { headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET } }
    );
    if (!alpRes.ok) throw new Error('Alpaca error ' + alpRes.status);

    const data      = await alpRes.json();
    const snapshots = data.snapshots || {};

    let calls = {}, puts = {}, totalCallOI = 0, totalPutOI = 0;

    Object.entries(snapshots).forEach(([sym, snap]) => {
      const oi = snap.openInterest || snap.open_interest ||
        (snap.latestQuote && snap.latestQuote.oi) || 0;
      let strike = snap.details ? snap.details.strikePrice : null;
      let type   = snap.details ? snap.details.optionType  : null;
      if (!strike || !type) {
        const m = sym.match(/([CP])(\d{8})$/);
        if (m) { type = m[1]==='C'?'call':'put'; strike = parseInt(m[2])/1000; }
      }
      if (!strike || !type) return;
      const weight = oi > 0 ? oi : 1;
      if (type==='call') { calls[strike]=(calls[strike]||0)+weight; totalCallOI+=weight; }
      else               { puts[strike] =(puts[strike] ||0)+weight; totalPutOI +=weight; }
    });

    const pcr        = totalCallOI > 0 ? totalPutOI/totalCallOI : 0;
    const callArr    = Object.entries(calls).map(([s,oi])=>({strike:parseFloat(s),oi})).sort((a,b)=>a.strike-b.strike);
    const putArr     = Object.entries(puts).map(([s,oi]) =>({strike:parseFloat(s),oi})).sort((a,b)=>a.strike-b.strike);
    const callsAbove = callArr.filter(c=>c.strike>=gldPrice).sort((a,b)=>b.oi-a.oi);
    const putsBelow  = putArr.filter(p=>p.strike<=gldPrice).sort((a,b)=>b.oi-a.oi);
    const maxPain    = calcMaxPain(calls, puts);

    const allS   = [...new Set([...callArr.map(c=>c.strike),...putArr.map(p=>p.strike)])].sort((a,b)=>a-b);
    const strikes = [
      ...allS.filter(s=>s<=gldPrice).slice(-6),
      ...allS.filter(s=>s> gldPrice).slice(0,6)
    ].map(s=>({ strike:s, futuresStrike:parseFloat((s*multiplier).toFixed(0)), callOI:calls[s]||0, putOI:puts[s]||0 }));

    res.status(200).json({
      pcr: parseFloat(pcr.toFixed(2)), totalCallOI, totalPutOI,
      callWall:   callsAbove.length>0 ? (callsAbove[0].strike*multiplier).toFixed(0) : null,
      callWallOI: callsAbove.length>0 ? callsAbove[0].oi : 0,
      putWall:    putsBelow.length >0 ? (putsBelow[0].strike *multiplier).toFixed(0) : null,
      putWallOI:  putsBelow.length >0 ? putsBelow[0].oi  : 0,
      maxPain:    maxPain ? (maxPain*multiplier).toFixed(0) : null,
      gldPrice, goldPrice, multiplier: parseFloat(multiplier.toFixed(4)),
      expiry: expiry.toLocaleDateString('en-US',{month:'short',day:'numeric'}),
      daysLeft, strikes
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

function getNextFriday() {
  const d = new Date();
  while (d.getDay()!==5) d.setDate(d.getDate()+1);
  return new Date(d);
}

function calcMaxPain(calls, puts) {
  const all = [...new Set([...Object.keys(calls),...Object.keys(puts)])].map(Number).sort((a,b)=>a-b);
  let minPain=Infinity, best=all[0]||0;
  all.forEach(t=>{
    let pain=0;
    Object.entries(calls).forEach(([s,oi])=>{const st=parseFloat(s);if(t>st)pain+=(t-st)*oi;});
    Object.entries(puts).forEach(([s,oi]) =>{const st=parseFloat(s);if(t<st)pain+=(st-t)*oi;});
    if(pain<minPain){minPain=pain;best=t;}
  });
  return best;
}
