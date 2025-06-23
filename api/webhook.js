import fs from 'fs';
import path from 'path';

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123test';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
    // FB webhook verification
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
    const body = req.body;
    if (body.object === 'page') {
      res.status(200).send('EVENT_RECEIVED'); // Respond ASAP to FB

      for (const entry of body.entry) {
        const events = entry.messaging || [];
        for (const webhookEvent of events) {
          const senderId = webhookEvent.sender?.id;
          const pageId = webhookEvent.recipient?.id;
          const userMessage = webhookEvent.message?.text;

          if (!senderId || !pageId || typeof userMessage !== 'string') {
            console.warn('⚠️ Skipping event, missing/invalid fields:', { senderId, pageId, userMessage });
            continue;
          }

          // Async background processing
          (async () => {
            try {
              const config = getPageConfig(pageId);
              if (!config) {
                console.warn('⚠️ No config for page:', pageId);
                return;
              }
              const { PAGE_ACCESS_TOKEN, ASSISTANT_ID } = config;

              const replyText = await getAssistantReply(ASSISTANT_ID, userMessage, senderId, pageId);
              await sendFacebookMessage(senderId, replyText, PAGE_ACCESS_TOKEN);
            } catch (err) {
              console.error('❌ Processing error:', err);
            }
          })();
        }
      }
      return; // already sent
    } else {
      return res.sendStatus(404);
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}

// Full Assistants API logic, NO INSTRUCTIONS in code!
async function getAssistantReply(assistantId, userMessage, senderId, pageId) {
  try {
    // 1. Create new thread for each chat (or use DB for persistent threads per user if needed)
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const thread = await threadRes.json();
    const threadId = thread.id;
    if (!threadId) throw new Error('No threadId returned from OpenAI');

    // 2. Post message to thread (add channel/user as metadata if you want)
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'user',
        content: userMessage,
        metadata: {
          senderId,
          pageId,
          // channel: 'messenger', // add more if needed
        }
      }),
    });

    // 3. Start the assistant run
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
    if (!runId) throw new Error('No runId returned from OpenAI');

    // 4. Poll for run completion (max 15s, check every 1s)
    let status = run.status;
    let waited = 0;
    while (status !== 'completed' && status !== 'failed' && waited < 15) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      waited += 1;
      const statusRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      });
      const statusData = await statusRes.json();
      status = statusData.status;
    }

    if (status !== 'completed') {
      console.error('❌ Assistant run not completed in time');
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
    console.error('❌ [Assistant] API error:', err);
    return 'Sorry, I could not process your request.';
  }
}

// FB reply logic as before
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
