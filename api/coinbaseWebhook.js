const crypto = require('crypto');
const https = require('https');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // 讀取 Raw Body
  const rawBody = await new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
  });

  // 驗證簽章
  const signature = req.headers['x-cc-webhook-signature'];
  const hmac = crypto.createHmac('sha256', process.env.COINBASE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (hmac !== signature) {
    return res.status(400).send('Invalid signature');
  }

  // 解析 JSON Payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
    console.log('[Webhook] Payload:', payload);
  } catch (err) {
    return res.status(400).send('Invalid JSON');
  }

  // 提取訂單資訊
  const eventType = payload.event?.type;
  const orderId = payload.data?.metadata?.shopify_order_id;
  const amount = payload.data?.pricing?.local?.amount;
  const currency = payload.data?.pricing?.local?.currency;

  if (eventType !== 'charge:confirmed') {
    return res.status(200).send('Not a confirmed charge, skipping');
  }

  if (!orderId || !amount || !currency) {
    return res.status(400).send('Missing required fields');
  }

  // 建立 Shopify 交易紀錄
  const store = process.env.SHOPIFY_STORE; // 例如 'gogetthis04215'
  const token = process.env.SHOPIFY_API_TOKEN;

  const body = JSON.stringify({
    transaction: {
      amount: amount,
      currency: currency,
      kind: 'capture' // ⚠️ 關鍵：改為 capture，避免 "sale is not a valid transaction" 錯誤
    }
  });

  const options = {
    hostname: `${store}.myshopify.com`,
    path: `/admin/api/2024-04/orders/${orderId}/transactions.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const response = await new Promise((resolve, reject) => {
    const reqShopify = https.request(options, resShopify => {
      let data = '';
      resShopify.on('data', chunk => data += chunk);
      resShopify.on('end', () => resolve({ status: resShopify.statusCode, body: data }));
    });

    reqShopify.on('error', reject);
    reqShopify.write(body);
    reqShopify.end();
  });

  console.log('Shopify 回傳:', response.body);

  if (response.status >= 200 && response.status < 300) {
    return res.status(200).send('ok');
  } else {
    return res.status(500).send(`Shopify error: ${response.body}`);
  }
};
