module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  try {
    const [goldRes, dxyRes] = await Promise.all([
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=2d'),
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=2d')
    ]);
    const goldData = await goldRes.json();
    const dxyData  = await dxyRes.json();
    const gq = goldData.chart.result[0];
    const dq = dxyData.chart.result[0];
    res.status(200).json({
      gold: {
        price: gq.meta.regularMarketPrice,
        prev:  gq.meta.previousClose || gq.meta.chartPreviousClose,
        high:  gq.meta.regularMarketDayHigh,
        low:   gq.meta.regularMarketDayLow
      },
      dxy: {
        price: dq.meta.regularMarketPrice,
        prev:  dq.meta.previousClose || dq.meta.chartPreviousClose
      }
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
