// api/coinbaseWebhook.js

const crypto = require('crypto');
const https = require('https');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const COINBASE_SHARED_SECRET = process.env.COINBASE_SHARED_SECRET;

module.exports = async (req, res) => {
  try {
    // 驗證 POST
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-cc-webhook-signature'];

    // 驗證 Coinbase 簽名
    const expectedSignature = crypto
      .createHmac('sha256', COINBASE_SHARED_SECRET)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.warn('❌ Invalid signature');
      return res.status(400).send('Invalid signature');
    }

    const payload = req.body;
    console.log('[Webhook] Payload:', payload);

    const eventType = payload.event?.type;
    const orderId = payload.data?.metadata?.shopify_order_id;
    const amount = payload.data?.pricing?.local?.amount;
    const currency = payload.data?.pricing?.local?.currency;

    if (eventType !== 'charge:confirmed' || !orderId) {
      return res.status(200).send('Ignored');
    }

    // 呼叫 Shopify API，標記訂單為已付款
    const options = {
      hostname: `${SHOPIFY_STORE}.myshopify.com`,
      path: `/admin/api/2024-04/orders/${orderId}/close.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      },
    };

    const shopifyRes = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.end(); // 不需要 body
    });

    console.log('✅ Shopify 已標記訂單已付款：', {
      orderId,
      amount,
      currency,
    });

    res.status(200).send('ok');
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).send('Internal Server Error');
  }
};
