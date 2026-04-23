import https from 'https';
https.get('https://partners.alphaarcade.com/api/v1/markets', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const markets = JSON.parse(data);
      console.log("MARKET WITH REWARDS:");
      const rewardMarket = markets.find((m: any) => m.rewardsMinContracts > 0);
      console.log(rewardMarket);
    } catch(e) {
      console.log(data);
    }
  });
});
