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
      // Respond to Messenger immediately
      res.status(200).send('EVENT_RECEIVED');

      // Async process all messages
      for (const entry of body.entry) {
        const messagingEvents = entry.messaging || [];
        for (const webhookEvent of messagingEvents) {
          const senderId = webhookEvent.sender?.id;
          const pageId = webhookEvent.recipient?.id;
          const userMessage = webhookEvent.message?.text;

          if (!senderId || !pageId || typeof userMessage !== 'string') {
            console.warn('⚠️ Skipping event, missing/invalid fields:', { senderId, pageId, userMessage });
            continue;
          }

          // Process in background (fire-and-forget)
          (async () => {
            try {
              const config = getPageConfig(pageId);
              if (!config) {
                console.warn('⚠️ No config for page:', pageId);
                return;
              }
              const { PAGE_ACCESS_TOKEN, ASSISTANT_ID } = config;
              // Assistant API logic here
              const replyText = await getAssistantReply(userMessage, ASSISTANT_ID);
              await sendFacebookMessage(senderId, replyText, PAGE_ACCESS_TOKEN);
            } catch (err) {
              console.error('❌ Processing error:', err);
            }
          })();
        }
      }
      return;
    } else {
      return res.sendStatus(404);
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}

// 🔧 OpenAI Assistants API logic
async function getAssistantReply(userText, assistantId) {
  try {
    // 1. Create a new thread
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const thread = await threadRes.json();
    const threadId = thread.id;

    // 2. Add the user message to the thread
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'user',
        content: userText,
      }),
    });

    // 3. Run the assistant on this thread
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

    // 4. Poll until run is complete (max 20s)
    let status = 'queued';
    let waited = 0;
    let runData = null;
    while (status !== 'completed' && status !== 'failed' && waited < 20000) {
      await new Promise(res => setTimeout(res, 1500));
      waited += 1500;
      const statusRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      });
      runData = await statusRes.json();
      status = runData.status;
    }

    if (status === 'failed') {
      console.error('❌ Assistant run failed:', runData);
      return 'Sorry, something went wrong.';
    }
    if (status !== 'completed') {
      return 'Sorry, I could not process your request in time.';
    }

    // 5. Fetch messages, return assistant's latest
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
