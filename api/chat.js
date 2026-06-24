// api/chat.js
// Vercel serverless function — runs on Vercel's servers
// Gemini key stored in Vercel environment variables (never in browser)
// No cold starts — spins up in ~200ms on every request

export default async function handler(req, res) {

  // Allow chatbot page to call this endpoint
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight request
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { systemPrompt, messages } = req.body;

  if (!systemPrompt || !messages) {
    return res.status(400).json({ error: "systemPrompt and messages required" });
  }

  // Key lives in Vercel environment variables — never exposed to browser
  const GEMINI_KEY = process.env.GEMINI_KEY;

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: "GEMINI_KEY not configured in Vercel environment variables" });
  }

  try {

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: messages.map(m => ({
            role:  m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          }))
        })
      }
    );

    if (!response.ok) {
      const err = await response.json();
      console.error("Gemini error:", err);
      return res.status(500).json({ error: "Gemini API error", detail: err });
    }

    const data  = await response.json();
    const reply = data.candidates[0].content.parts[0].text;

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err.message);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
}
