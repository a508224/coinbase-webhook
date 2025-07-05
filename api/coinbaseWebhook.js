export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

    // 讀取 raw body
    const raw = await new Promise((resolve) => {
      let data = ''
      req.on('data', chunk => data += chunk)
      req.on('end', () => resolve(data))
    })

    // ======== 可選：跳過驗證 =========
    // const sig = req.headers['x-cc-webhook-signature']
    // const hmac = crypto.createHmac('sha256', process.env.COINBASE_WEBHOOK_SECRET).update(raw).digest('hex')
    // if (sig !== hmac) return res.status(400).send('Invalid signature')

    const payload = JSON.parse(raw)
    const eventType = payload.event.type

    if (eventType === 'charge:confirmed') {
      const data = payload.data
      const orderId = data.metadata?.shopify_order_id
      const amount = data.payments?.[0]?.value?.local?.amount
      const currency = data.payments?.[0]?.value?.local?.currency

      console.log('→ 準備標示已付款', { orderId, amount, currency })

      if (!orderId) throw new Error('缺少 Shopify 訂單編號')

      // Shopify API 請求
      const store = process.env.SHOPIFY_STORE
      const token = process.env.SHOPIFY_API_TOKEN

      const body = JSON.stringify({
        kind: 'sale',
        status: 'success',
        amount,
        currency
      })

      const options = {
        hostname: `${store}.myshopify.com`,
        path: `/admin/api/2024-04/orders/${orderId}/transactions.json`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token
        }
      }

      const reqToShopify = https.request(options, shopifyRes => {
        let responseData = ''
        shopifyRes.on('data', chunk => responseData += chunk)
        shopifyRes.on('end', () => {
          console.log('✅ Shopify 回應:', responseData)
          res.status(200).send('ok')
        })
      })

      reqToShopify.on('error', err => {
        console.error('❌ Shopify 錯誤:', err)
        res.status(500).send('Shopify error')
      })

      reqToShopify.write(body)
      reqToShopify.end()
    } else {
      res.status(200).send('not a charge:confirmed event')
    }

  } catch (err) {
    console.error('❌ 程式錯誤:', err)
    res.status(500).send('FUNCTION ERROR: ' + err.message)
  }
}
