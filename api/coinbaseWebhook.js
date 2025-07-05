const crypto = require('crypto');
const https = require('https');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const rawBody = await new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
  });

  const sig = req.headers['x-cc-webhook-signature'];
  const hmac = crypto.createHmac('sha256', process.env.COINBASE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

 // if (sig !== hmac) return res.status(400).send('Invalid signature');

  const payload = JSON.parse(rawBody);
  console.log('[Webhook] Payload:', payload);

  const orderId = payload.data?.metadata?.shopify_order_id;
  const amount = payload.data?.pricing?.local?.amount;
  const currency = payload.data?.pricing?.local?.currency;

  if (!orderId) return res.status(400).send('Missing orderId');

  const store = process.env.SHOPIFY_STORE;
  const token = process.env.SHOPIFY_API_TOKEN;

  const body = JSON.stringify({
    transaction: {
      amount,
      currency,
      kind: 'sale',
      status: 'success'
    }
  });

  const options = {
    hostname: `${store}.myshopify.com`,
    path: `/admin/api/2024-04/orders/${orderId}/transactions.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    }
  };

  const shopifyReq = https.request(options, (shopifyRes) => {
    let data = '';
    shopifyRes.on('data', chunk => data += chunk);
    shopifyRes.on('end', () => {
      console.log('Shopify 回傳:', data);
      res.status(200).send('ok');
    });
  });

  shopifyReq.on('error', (err) => {
    console.error('Shopify 請求錯誤:', err);
    res.status(500).send('Shopify error');
  });

  shopifyReq.write(body);
  shopifyReq.end();
};
