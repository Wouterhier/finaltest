const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123test';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Page access tokens for multiple FB pages
const PAGE_TOKENS = {
  'PAGE_ID_1': process.env.PAGE_ACCESS_TOKEN,
  'PAGE_ID_2': process.env.PAGE_ACCESS_TOKEN_SECOND,
};

// Map FB page ID to ChatGPT Assistant ID
const userAssistantMapping = {
  'PAGE_ID_1': 'asst_abc123...',  // Replace with real assistant ID
  'PAGE_ID_2': 'asst_xyz456...',  // Replace with real assistant ID
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    } else {
      console.error('Verification failed', { mode, token });
      return res.status(403).send('Verification failed');
    }
  }

  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry) {
        const pageId = entry.id;
        const webhookEvent = entry.messaging?.[0];
        const senderId = webhookEvent?.sender?.id;
        const userMessage = webhookEvent?.message?.text;

        if (senderId && userMessage) {
          console.log(`📩 ${pageId} | ${senderId}: ${userMessage}`);
          try {
            const assistantId = userAssistantMapping[pageId];
            const pageAccessToken = PAGE_TOKENS[pageId];
            const replyText = await queryAssistant(assistantId, userMessage);
            await sendFacebookMessage(pageAccessToken, senderId, replyText);
          } catch (error) {
            console.error('❌ Error handling message:', error);
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Unsupported object');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}

async function queryAssistant(assistantId, message) {
  const response = await fetch('https://api.openai.com/v1/threads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      assistant_id: assistantId,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('OpenAI error:', err);
    return 'Sorry, I cannot respond now.';
  }

  const data = await response.json();
  const threadId = data.id;

  const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ assistant_id: assistantId }),
  });

  const runData = await runRes.json();
  const runId = runData.id;

  let status = 'queued';
  while (status !== 'completed') {
    await new Promise(res => setTimeout(res, 1000));
    const checkRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    const checkData = await checkRes.json();
    status = checkData.status;
  }

  const messagesRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });
  const messagesData = await messagesRes.json();
  return messagesData.data?.[0]?.content?.[0]?.text?.value || 'Sorry, no response.';
}

async function sendFacebookMessage(pageToken, recipientId, messageText) {
  const url = `https://graph.facebook.com/v15.0/me/messages?access_token=${pageToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: messageText },
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('FB send error:', error);
  }
}
