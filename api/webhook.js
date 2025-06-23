import fs from 'fs';
import path from 'path';

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123test';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🔁 Load page-specific config (token + assistant instructions)
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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified');
      return res.status(200).send(challenge);
    } else {
      console.warn('❌ Verification failed', { mode, token });
      return res.status(403).send('Verification failed');
    }
  }

  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging?.[0];
        if (!webhookEvent) continue;

        const senderId = webhookEvent.sender?.id;
        const pageId = webhookEvent.recipient?.id;
        const userMessage = webhookEvent.message?.text;

        if (!senderId || !pageId || !userMessage) {
          console.warn('⚠️ Missing fields:', { senderId, pageId, userMessage });
          continue;
        }

        console.log(`📥 Message from ${senderId} to Page ${pageId}: ${userMessage}`);

        const config = getPageConfig(pageId);
        if (!config) {
          console.warn('⚠️ No config found for Page ID:', pageId);
          continue;
        }

        const { PAGE_ACCESS_TOKEN, ASSISTANT_INSTRUCTIONS } = config;

        try {
          const replyText = await getChatGptReply(userMessage, ASSISTANT_INSTRUCTIONS);
          await sendFacebookMessage(senderId, replyText, PAGE_ACCESS_TOKEN);
        } catch (err) {
          console.error('❌ Error handling message:', err);
        }
      }

      return res.status(200).send('EVENT_RECEIVED');
    } else {
      console.warn('❌ Unsupported event object:', body.object);
      return res.sendStatus(404);
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}

// 🔧 Ask OpenAI based on dynamic instructions
async function getChatGptReply(userText, instructions) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: userText },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('❌ OpenAI error:', errText);
      return 'Sorry, I couldn’t process that.';
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'Sorry, no reply was generated.';
  } catch (err) {
    console.error('❌ OpenAI fetch failed:', err);
    return 'Sorry, something went wrong.';
  }
}

// 🔧 Send reply via Facebook API
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
