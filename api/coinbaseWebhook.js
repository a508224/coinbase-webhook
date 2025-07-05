import crypto from 'crypto';

export default async (req, res) => {
  const raw = await new Promise(resolve => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
  });

  const sig = req.headers['x-cc-webhook-signature'];
  const hmac = crypto
    .createHmac('sha256', process.env.COINBASE_WEBHOOK_SECRET)
    .update(raw)
    .digest('hex');

  if (sig !== hmac) return res.status(400).send('bad sig');

  const event = JSON.parse(raw).event;

  if (event.type === 'charge:confirmed') {
    console.log('✅ 收到付款確認', event.data.code);
    // 未來你可以在這裡加上 Shopify 自動改單狀態的功能
  }

  res.status(200).send('ok');
};
