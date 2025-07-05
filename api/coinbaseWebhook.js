import crypto from 'crypto'
import https from 'https'

export default async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

  const raw = await new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => (data += chunk))
    req.on('end', () => resolve(data))
  })

  const sig = req.headers['x-cc-webhook-signature']
  const hmac = crypto
    .createHmac('sha256', process.env.COINBASE_WEBHOOK_SECRET)
    .update(raw)
    .digest('hex')

  if (sig !== hmac) return res.status(400).send('Invalid signature')

  const event = JSON.parse(raw)

  if (event.type === 'charge:confirmed') {
    const orderId = event.data.metadata.order_id

    console.log('✅ 收到付款確認 AAAAAAA', orderId)

    // 🛒 Shopify 訂單 API 呼叫區段
    const shopifyStore = process.env.SHOPIFY_STORE
    const shopifyToken = process.env.SHOPIFY_API_TOKEN

    const shopifyOptions = {
      hostname: `${shopifyStore}.myshopify.com`,
      path: `/admin/api/2024-04/orders/${orderId}/transactions.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': shopifyToken
      }
    }

    const shopifyPayload = JSON.stringify({
      transaction: {
        kind: 'sale',
        status: 'success',
        amount: event.data.pricing.local.amount,
        currency: event.data.pricing.local.currency
      }
    })

    const shopifyReq = https.request(shopifyOptions, shopifyRes => {
      let body = ''
      shopifyRes.on('data', chunk => (body += chunk))
      shopifyRes.on('end', () => {
        console.log('🟢 Shopify 回應：', body)
      })
    })

    shopifyReq.on('error', error => {
      console.error('Shopify 更新失敗：', error)
    })

    shopifyReq.write(shopifyPayload)
    shopifyReq.end()
  }

  res.status(200).send('ok')
}

