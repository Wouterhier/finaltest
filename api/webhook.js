import fs from 'fs';
import path from 'path';

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123test';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Load page config
function getPageConfig(pageId) {
  try {
    const configPath = path.resolve('./api/pageConfigs.json');
    const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return configs[pageId] || null;
  } catch (err) {
    console.error('❌ Failed to load pageConfigs:', err);
    return null;
  }
}

// Main handler
export default async function handler(req, res) {
  // Messenger webhook verification
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified');
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Verification failed');
    }
  }

  // Messenger message handler
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object === 'page') {
      // Respond immediately to Messenger to avoid timeout/loop
      res.status(200).send('EVENT_RECEIVED');

      // Process each message in background (async, fire-and-forget)
      for (const entry of body.entry) {
        const messagingEvents = entry.messaging || [];
        for (const webhookEvent of messagingEvents) {
          // LOG RAW EVENT for debug
          console.log('🟡 RAW EVENT:', JSON.stringify(webhookEvent, null, 2));

          const senderId = webhookEvent.sender?.id;
          const pageId = webhookEvent.recipient?.id;
          const userMessage = webhookEvent.message?.text;

          if (!senderId || !pageId || typeof userMessage !== 'string') {
            console.warn('⚠️ Skipping event, missing/invalid fields:', { senderId, pageId, userMessage });
            continue;
          }

          console.log('🔵 Processing message:', { senderId, pageId, userMessage });

          (async () => {
            try {
              const config = getPageConfig(pageId);
              if (!config) {
                console.warn('⚠️ No config for page:', pageId);
                return;
              }
              const { PAGE_ACCESS_TOKEN, ASSISTANT_INSTRUCTIONS } = config;
              const replyText = await getChatGptReply(userMessage, ASSISTANT_INSTRUCTIONS);
              await sendFacebookMessage(senderId, replyText, PAGE_ACCESS_TOKEN);
              console.log('✅ Sent reply to', senderId);
            } catch (err) {
              console.error('❌ Processing error:', err);
            }
          })();
        }
      }
      return; // Already sent response above
    } else {
      return res.sendStatus(404);
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}

// Ask OpenAI (GPT) with instructions (or fallback)
async function getChatGptReply(userText, instructions) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o', // or 'gpt-3.5-turbo'
        messages: [
          { role: 'system', content: instructions || 'You are a helpful assistant.' },
          { role: 'user', content: userText },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('❌ OpenAI error:', errText);
      return 'Sorry, I could not process your request.';
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'Sorry, no reply generated.';
  } catch (err) {
    console.error('❌ OpenAI fetch failed:', err);
    return 'Sorry, something went wrong.';
  }
}

// Send reply via Facebook Messenger API
async function sendFacebookMessage(recipientId, messageText, PAGE_ACCESS_TOKEN) {
  try {
    const res = await fetch(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: messageText },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('❌ Facebook API error:', errText);
    }
  } catch (err) {
    console.error('❌ Failed to send FB message:', err);
  }
}
