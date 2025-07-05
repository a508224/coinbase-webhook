// /api/coinbaseWebhook.js

const crypto = require('crypto');
const https = require('https');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const COINBASE_SHARED_SECRET = process.env.COINBASE_SHARED_SECRET;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-cc-webhook-signature'];

  // 驗證 Coinbase Webhook 簽名
  const expectedSignature = crypto
    .createHmac('sha256', COINBASE_SHARED_SECRET)
    .update(rawBody)
    .digest('hex');

//  if (signature !== expectedSignature) {
//    console.warn('[驗證失敗] Coinbase Signature 不正確');
//    return res.status(400).send('Invalid signature');
//  }

  const payload = req.body;
  console.log('[Webhook] Payload:', payload);

  const eventType = payload?.event?.type;
  const orderId = payload?.data?.metadata?.shopify_order_id;
  const amount = payload?.data?.pricing?.local?.amount;
  const currency = payload?.data?.pricing?.local?.currency;

  if (eventType !== 'charge:confirmed' || !orderId) {
    console.log('[忽略] eventType 不符或缺少 orderId');
    return res.status(200).send('Ignored');
  }

  // 送出 Shopify API 請求：關閉訂單
  const options = {
    hostname: `${SHOPIFY_STORE}.myshopify.com`,
    path: `/admin/api/2024-04/orders/${orderId}/close.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    }
  };

  const shopifyRes = await new Promise((resolve, reject) => {
    const reqShopify = https.request(options, (resShopify) => {
      let data = '';
      resShopify.on('data', chunk => data += chunk);
      resShopify.on('end', () => resolve({ statusCode: resShopify.statusCode, body: data }));
    });

    reqShopify.on('error', reject);
    reqShopify.end();
  });

  console.log('Shopify 回傳:', shopifyRes.body);
  res.status(200).send('ok');
};
