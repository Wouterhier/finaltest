// File: /api/webhook.js

export default function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verified');
        res.status(200).send(challenge);
      } else {
        res.status(403).send('❌ Forbidden: token mismatch');
      }
    } else {
      res.status(400).send('❌ Bad Request: missing query');
    }
  } else if (req.method === 'POST') {
    console.log('📩 Received webhook event:', req.body);
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.status(405).send({ error: 'Method not allowed' });
  }
}
