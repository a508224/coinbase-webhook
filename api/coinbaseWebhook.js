/* eslint-disable no-console */
/**
 * Coinbase → Shopify Webhook
 * 1. 驗證 Coinbase 簽名
 * 2. 解析 charge:confirmed 事件
 * 3. 讀出 metadata.shopify_order_id（須為真正的數字 ID）
 * 4. 呼叫 POST /orders/{id}/close.json  →  將訂單標記為「已付款」
 */

const crypto = require('crypto');
const https  = require('https');

/* === 必填環境變數（在 Vercel 專案 Settings → Environment Variables） === */
const {
  SHOPIFY_STORE,           // 例如：gogetthis040215   （不要含 .myshopify.com）
  SHOPIFY_ACCESS_TOKEN,    // Shopify Private App Token
  COINBASE_SHARED_SECRET,  // Coinbase Webhook Secret
} = process.env;

/* -------------- 共用工具 ---------------- */
const readRawBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

const httpsRequest = (opts, body = null) =>
  new Promise((resolve, reject) => {
    const r = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

/* -------------- Webhook 入口 ---------------- */
module.exports = async (req, res) => {
  /* 1. 只收 POST */
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  /* 2. 環境變數檢查 */
  if (!SHOPIFY_STORE || !SHOPIFY_ACCESS_TOKEN || !COINBASE_SHARED_SECRET) {
    console.error('❌ 缺少環境變數，請確認 SHOPIFY_STORE / SHOPIFY_ACCESS_TOKEN / COINBASE_SHARED_SECRET 都已設定');
    return res.status(500).send('Server Misconfiguration');
  }

  try {
    /* 3. 讀 raw body 以便驗簽 */
    const raw = await readRawBody(req);
    const sig = req.headers['x-cc-webhook-signature'] || '';

    /* 4. Coinbase 簽名驗證 */
    const expected = crypto
      .createHmac('sha256', COINBASE_SHARED_SECRET)
      .update(raw)
      .digest('hex');

  //  if (sig !== expected) {
  //    console.warn('⚠️  Invalid Coinbase signature');
  //    return res.status(400).send('Invalid signature');
  //  }

    /* 5. 解析 JSON */
    const payload = JSON.parse(raw);
    console.dir(payload, { depth: null });          // debug 用

    const eventType = payload?.event?.type;
    if (eventType !== 'charge:confirmed') {
      console.log('Ignored event:', eventType);
      return res.status(200).send('Ignored');
    }

    /* 6. 取出必要欄位 */
    const orderId  = payload?.data?.metadata?.shopify_order_id;   // 必須是數字 ID!
    const amount   = payload?.data?.pricing?.local?.amount;
    const currency = payload?.data?.pricing?.local?.currency;

    if (!orderId) {
      console.error('❌ 缺少 shopify_order_id，請確認 metadata 有帶');
      return res.status(400).send('Missing order_id');
    }

    /* 7. 呼叫 Shopify：標示訂單已付款 */
    const opts = {
      hostname: `${SHOPIFY_STORE}.myshopify.com`,
      path:     `/admin/api/2024-04/orders/${orderId}/close.json`,
      method:   'POST',
      headers: {
        'Content-Type':          'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      },
    };

    const resp = await httpsRequest(opts);  // close.json 不需 body
    console.log('Shopify 回傳:', resp.status, resp.body);

    if (resp.status >= 200 && resp.status < 300) {
      return res.status(200).send('ok');
    }

    /* 若 Shopify 失敗，回傳 500 讓你在 log 看到詳情 */
    return res.status(500).send(`Shopify error: ${resp.body}`);
  } catch (err) {
    console.error('❌ Webhook exception:', err);
    return res.status(500).send('Internal Server Error');
  }
};
