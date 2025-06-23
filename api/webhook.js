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
    console.log('🟣 RAW POST BODY:', JSON.stringify(body, null, 2));
    if (body.object === 'page') {
      res.status(200).send('EVENT_RECEIVED');
      for (const entry of body.entry) {
        const messagingEvents = entry.messaging || [];
        for (const webhookEvent of messagingEvents) {
          console.log('🟡 RAW EVENT:', JSON.stringify(webhookEvent, null, 2));
          const senderId = webhookEvent.sender?.id;
          const pageId = webhookEvent.recipient?.id;
          const userMessage = webhookEvent.message?.text;

          if (!senderId || !pageId || typeof userMessage !== 'string') {
            console.warn('⚠️ Skipping event, missing/invalid fields:', { senderId, pageId, userMessage });
            continue;
          }

          console.log('🔵 Processing message:', { senderId, pageId, userMessage });

          // Process message in the background (fire-and-forget)
          (async () => {
            try {
              const config = getPageConfig(pageId);
              if (!config) {
                console.warn('⚠️ No config for page:', pageId);
                return;
              }
              const { PAGE_ACCESS_TOKEN, ASSISTANT_ID } = config;

              const replyText = await getAssistantReply(userMessage, ASSISTANT_ID);
              console.log('🟢 Assistant Reply:', replyText);
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

// -- OpenAI Assistant Integration with Debug Logs --
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
    const threadData = await threadRes.json();
    const threadId = threadData.id;
    console.log('🟡 [Assistant] threadId:', threadId);

    // 2. Add message to thread
    const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
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
    const msgData = await msgRes.json();
    console.log('🟡 [Assistant] msgData:', msgData);

    // 3. Run assistant on thread
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
    const runData = await runRes.json();
    const runId = runData.id;
    console.log('🟡 [Assistant] runId:', runId, '| runData:', runData);

    // 4. Poll for completion
    let status = runData.status;
    let pollCount = 0;
    while (status !== 'completed' && status !== 'failed' && pollCount < 30) {
      await new Promise(res => setTimeout(res, 1500));
      const pollRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      });
      const pollData = await pollRes.json();
      status = pollData.status;
      pollCount++;
      console.log('🟡 [Assistant] Poll', pollCount, 'status:', status);
    }

    if (status !== 'completed') {
      console.error('❌ [Assistant] Run did not complete:', status);
      return 'Sorry, I could not process your request.';
    }

    // 5. Fetch messages from thread
    const finalMsgsRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    });
    const finalMsgsData = await finalMsgsRes.json();
    const lastMessage = finalMsgsData.data?.find(msg => msg.role === 'assistant');
    console.log('🟡 [Assistant] lastMessage:', lastMessage);

    return lastMessage?.content?.[0]?.text?.value || 'Sorry, no reply generated.';
  } catch (err) {
    console.error('❌ [Assistant] API error:', err);
    return 'Sorry, something went wrong.';
  }
}

// -- Facebook send with Debug Logs --
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
    const fbResult = await res.text();
    if (!res.ok) {
      console.error('❌ Facebook API error:', fbResult);
    } else {
      console.log('🟢 Facebook send OK:', fbResult);
    }
  } catch (err) {
    console.error('❌ Failed to send FB message:', err);
  }
}
