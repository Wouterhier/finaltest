const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123test';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Step 1: User-Assistant Mapping
const userAssistantMapping = {
  'messenger_user_id_1': 'assistant_id_1',
  'messenger_user_id_2': 'assistant_id_2'
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
        const webhookEvent = entry.messaging[0];
        const senderId = webhookEvent.sender.id;

        if (webhookEvent.message && webhookEvent.message.text) {
          const userMessage = webhookEvent.message.text;
          console.log(`Received message from ${senderId}: ${userMessage}`);

          try {
            const replyText = await getChatGptReply(userMessage);
            await sendFacebookMessage(senderId, replyText);
          } catch (error) {
            console.error('Error processing message:', error);
          }
        } else {
          console.warn('Received event with no message or text:', webhookEvent);
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      console.error('Unsupported body object:', body.object);
      return res.sendStatus(404);
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}

async function getChatGptReply(message) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: message },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      return 'Sorry, I could not process your message.';
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Sorry, I could not process your message.';
  } catch (error) {
    console.error('OpenAI API fetch error:', error);
    return 'Sorry, I could not process your message.';
  }
}

async function sendFacebookMessage(recipientId, messageText) {
  try {
    const url = `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: messageText },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Facebook API error:', errorText);
    }
  } catch (error) {
    console.error('Facebook message send error:', error);
  }
}
