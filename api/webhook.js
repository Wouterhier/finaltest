// File: /api/webhook.js

export default function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verified successfully.');
        res.status(200).send(challenge);
      } else {
        console.warn('Verification failed. Tokens do not match.');
        res.status(403).send('Forbidden: tokens do not match');
      }
    } else {
      res.status(400).send('Bad Request');
    }
  }

  if (req.method === 'POST') {
    console.log('Webhook POST received:', JSON.stringify(req.body, null, 2));
    res.status(200).send('EVENT_RECEIVED');
  }
}
