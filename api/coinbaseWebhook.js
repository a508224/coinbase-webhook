import crypto from 'crypto'
import https from 'https'

export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).send('Method Not Allowed')

  /** 讀 raw body（Edge function 必須手動蒐集） */
  const raw = await new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => data += chunk)
    req.on('end', () => resolve(data))
  })

  /** －－可選：若要驗證 Coinbase 簽名，把下列註解打開－－
  const sig  = req.headers['x-cc-webhook-signature']
  const hmac = crypto
      .createHmac('sha256', process.env.COINBASE_WEBHOOK_SECRET)
      .update(raw)
      .digest('hex')
  if (sig !== hmac) return res.status(400).send('Invalid signature')
  ---------------------------------------------------------------- */

  try {
    const payload = JSON.parse(raw)
    console.log('🧾 Webhook Payload:', JSON.stringify(payload, null, 2))

    if (payload.event?.type !== 'charge:confirmed')
      return res.status(200).send('not charge:confirmed')   // 其他事件直接回 200

    /* ---------- 解析測試 JSON ---------- */
    const meta        = payload.data?.metadata || {}
    const shopName    = process.env.SHOPIFY_STORE        // ex: gogetthis040215
    const shopToken   = process.env.SHOPIFY_API_TOKEN

    // 你的 Postman body 傳的是 shopify_order_id（用「數字 / 名稱」皆可）
    const orderRef    = meta.shopify_order_id || meta.order_id || meta.name
    if (!orderRef) throw new Error('缺少 shopify_order_id / order_id')

    /** 1️⃣ 先查真正的訂單數字 ID（若已經是數字就直接用） */
    const orderId =
      /^\d+$/.test(orderRef)
        ? orderRef
        : await lookupOrderIdByName(orderRef, shopName, shopToken)

    console.log('✅ 找到 Shopify 訂單 ID =', orderId)

    /** 2️⃣ 建立一筆「成功付款」交易（sale / success） */
    const amount   = payload.data?.pricing?.local?.amount || '0'
    const currency = payload.data?.pricing?.local?.currency || 'TWD'

    const trxBody = JSON.stringify({
      transaction: {
        kind:     'sale',
        status:   'success',
        amount,
        currency
      }
    })

    const trxOpts = {
      hostname: `${shopName}.myshopify.com`,
      path:     `/admin/api/2024-04/orders/${orderId}/transactions.json`,
      method:   'POST',
      headers: {
        'Content-Type':          'application/json',
        'X-Shopify-Access-Token': shopToken
      }
    }

    await httpRequest(trxOpts, trxBody)
    console.log('🟢 Shopify 已標記付款 success')

    /** 3️⃣ 讓 Shopify 自動寄付款成功信 */
    const notifyOpts = {
      hostname: `${shopName}.myshopify.com`,
      path:     `/admin/api/2024-04/orders/${orderId}/notify.json`,
      method:   'POST',
      headers: { 'X-Shopify-Access-Token': shopToken }
    }
    await httpRequest(notifyOpts)
    console.log('✉️  Shopify 已寄出付款通知')

    res.status(200).send('ok')
  } catch (err) {
    console.error('❌ FUNCTION ERROR:', err)
    res.status(500).send('FUNCTION ERROR: ' + err.message)
  }
}

/* ---------- 共用輔助函式 ---------- */

/** 用訂單名稱（如 #1003）換取真正數字 ID */
function lookupOrderIdByName(orderName, store, token) {
  return new Promise((resolve, reject) => {
    const encodedName = encodeURIComponent(orderName)        // # 需轉 %23
    const opts = {
      hostname: `${store}.myshopify.com`,
      path:     `/admin/api/2024-04/orders.json?name=${encodedName}`,
      method:   'GET',
      headers: { 'X-Shopify-Access-Token': token }
    }

    const req = https.request(opts, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        const orders = JSON.parse(body).orders || []
        return orders.length
          ? resolve(orders[0].id)
          : reject(new Error('Shopify order not found'))
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/** 簡化 https request（Promise 包裝）*/
function httpRequest(opts, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        if (res.statusCode! >= 200 && res.statusCode! < 300)
          return resolve(raw)
        reject(new Error(`HTTP ${res.statusCode}: ${raw}`))
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
