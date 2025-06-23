// /api/webhook.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Missing message in request body' });
    }

    // Call OpenAI using your own API key (set in Vercel)
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: message }]
      })
    });

    const data = await openaiRes.json();

    return res.status(200).json({ reply: data.choices?.[0]?.message?.content || 'No reply' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
