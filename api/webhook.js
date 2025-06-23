import fs from 'fs';
import path from 'path';

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123test';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🔁 Load page-specific config (token + assistant)
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

        const { PAGE_ACCESS_TOKEN, ASSISTANT_ID } = config;

        try {
          const replyText = await getAssistantReply(userMessage, ASSISTANT_ID);
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

// 🧠 Ask OpenAI Assistant using threads/runs/messages
async function getAssistantReply(userMessage, assistantId) {
  try {
    // 1. Create thread
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const thread = await threadRes.json();
    const threadId = thread.id;

    // 2. Add user message to thread
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'user',
        content: userMessage,
      }),
    });

    // 3. Run assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistant_id: assistantId,
      }),
    });
    const run = await runRes.json();
    const runId = run.id;

    // 4. Poll for completion
    let status = 'queued';
    let finalRun;
    let loops = 0;
    while (status !== 'completed' && status !== 'failed' && loops < 30) { // max ~30s
      await new Promise(resolve => setTimeout(resolve, 1000));
      const statusRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      });
      finalRun = await statusRes.json();
      status = finalRun.status;
      loops++;
    }
    if (status === 'failed') {
      console.error('❌ Assistant run failed:', finalRun);
      return 'Sorry, something went wrong.';
    }
    if (loops >= 30) {
      console.error('❌ Assistant polling timeout');
      return 'Sorry, I could not process your request in time.';
    }

    // 5. Fetch assistant reply
    const messagesRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    });
    const messagesData = await messagesRes.json();
    const lastMessage = messagesData.data?.find(msg => msg.role === 'assistant');
    return lastMessage?.content?.[0]?.text?.value || 'Sorry, no reply generated.';
  } catch (err) {
    console.error('❌ Assistant API error:', err);
    return 'Sorry, there was an issue.';
  }
}

// 🔧 Facebook reply
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
