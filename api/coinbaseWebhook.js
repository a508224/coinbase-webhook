import crypto from 'crypto'
import https from 'https'

export default async function handler(req, res) {
  // 只接受 POST
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

  /** 1️⃣ 讀取 Raw Body（Vercel Edge Function 要這樣拿） */
  const raw = await new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => (data += chunk))
    req.on('end', () => resolve(data))
  })

// const sig = req.headers['x-cc-webhook-signature']
// const hmac = crypto
//   .createHmac('sha256', process.env.COINBASE_WEBHOOK_SECRET)
//   .update(raw)
//   .digest('hex')

// if (sig !== hmac) return res.status(400).send('Invalid signature')


  /** 3️⃣ 解析事件 */
  const payload = JSON.parse(raw)
  console.log('🧾 Webhook Payload:', JSON.stringify(payload, null, 2))

  if (payload.event.type === 'charge:confirmed') {
    const data = payload.event.data
    const orderId = data.metadata?.order_id         // 這裡要有值才能對應 Shopify
    const amount   = data.pricing.local.amount
    const currency = data.pricing.local.currency

    console.log('✅ 收到付款確認，對應訂單：', orderId)

    if (orderId) {
      /** 4️⃣ 呼叫 Shopify Admin API → 建立一筆「成功付款」交易 */
      const store    = process.env.SHOPIFY_STORE      // 例：gogetthis040215
      const token    = process.env.SHOPIFY_API_TOKEN

      const opts = {
        hostname: `${store}.myshopify.com`,
        path:     `/admin/api/2024-04/orders/${orderId}/transactions.json`,
        method:   'POST',
        headers: {
          'Content-Type':          'application/json',
          'X-Shopify-Access-Token': token
        }
      }

      const body = JSON.stringify({
        transaction: {
          kind:     'sale',
          status:   'success',
          amount,
          currency
        }
      })

      const shopReq = https.request(opts, shopRes => {
        let resp = ''
        shopRes.on('data', c => (resp += c))
        shopRes.on('end', () => {
          console.log('🟢 Shopify 回應：', resp)

          /** 5️⃣ 觸發 Shopify 寄出訂單通知信 */
          notifyShopify(orderId, store, token)
        })
      })

      shopReq.on('error', err => console.error('Shopify 失敗', err))
      shopReq.write(body)
      shopReq.end()
    }
  }

  res.status(200).send('ok')
}

/** 叫 Shopify 寄出訂單通知信 */
function notifyShopify(orderId, store, token) {
  const options = {
    hostname: `${store}.myshopify.com`,
    path:     `/admin/api/2024-04/orders/${orderId}/notify.json`,
    method:   'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Shopify-Access-Token': token
    }
  }

  const req = https.request(options, res => {
    let out = ''
    res.on('data', c => (out += c))
    res.on('end', () => console.log('✉️  Shopify 已寄信：', out))
  })

  req.on('error', e => console.error('Notify error', e))
  req.end()
}
