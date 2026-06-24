// api/chat.js
// Vercel serverless function — Gemini proxy with auto retry
// Retries up to 3 times if Gemini returns an error

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { systemPrompt, messages } = req.body;

  if (!systemPrompt || !messages) {
    return res.status(400).json({ error: "systemPrompt and messages required" });
  }

  const GEMINI_KEY = process.env.GEMINI_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: "GEMINI_KEY not configured" });
  }

  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {

    try {

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          signal:  AbortSignal.timeout(10000),
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: messages.map(m => ({
              role:  m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }]
            })),
            generationConfig: {
              maxOutputTokens: 300,
              temperature: 0.7
            }
          })
        }
      );

      if (response.status === 429) {
        const waitMs = attempt * 1000;
        console.log(`Rate limited. Attempt ${attempt}/${MAX_RETRIES}. Waiting ${waitMs}ms...`);
        await sleep(waitMs);
        lastError = "Rate limited by Gemini";
        continue;
      }

      if (!response.ok) {
        const err = await response.json();
        console.error(`Gemini error attempt ${attempt}:`, err);
        lastError = err?.error?.message || "Gemini API error";
        if (attempt < MAX_RETRIES) await sleep(attempt * 800);
        continue;
      }

      const data  = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!reply) {
        lastError = "Empty response from Gemini";
        if (attempt < MAX_RETRIES) await sleep(attempt * 800);
        continue;
      }

      return res.status(200).json({ reply });

    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      lastError = err.message;
      if (attempt < MAX_RETRIES) await sleep(attempt * 800);
    }
  }

  console.error("All retries failed:", lastError);
  return res.status(500).json({
    error: "Failed after 3 attempts. Please try again.",
    detail: lastError
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
