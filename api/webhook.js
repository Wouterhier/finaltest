export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123test';
  const MAKE_WEBHOOK_URL = 'https://hook.us2.make.com/df8nl21pjuon0k0weypyghn7noc85rvd';

  if (req.method === 'GET') {
    // Messenger webhook verification
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Verification failed');
    }
  }

  if (req.method === 'POST') {
    // Respond to Messenger ASAP (to prevent retry/loops)
    res.status(200).send('EVENT_RECEIVED');
    // Forward the entire POST body to Make.com
    fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    }).catch(err => console.error('❌ Failed to relay to Make:', err));
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
