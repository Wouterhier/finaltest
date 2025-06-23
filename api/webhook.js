export default function handler(req, res) {
  const VERIFY_TOKEN = '123test';

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.status(403).send('Forbidden');
    }

  } else if (req.method === 'POST') {
    console.log('Webhook event received:', JSON.stringify(req.body, null, 2));
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.status(405).send('Method Not Allowed');
  }
}
