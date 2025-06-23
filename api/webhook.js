export default function handler(req, res) {
  if (req.method === 'GET') {
    const VERIFY_TOKEN = "test123";
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else if (req.method === 'POST') {
    console.log("Webhook POST: ", JSON.stringify(req.body));
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
