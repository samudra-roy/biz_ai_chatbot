// api/booking.js
// Vercel serverless function — forwards booking data to Google Sheets
// Called when AI has collected all customer booking details

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sheetsWebhook, ...bookingData } = req.body;

  if (!sheetsWebhook) {
    return res.status(400).json({ error: "sheetsWebhook is required" });
  }

  try {

    const response = await fetch(sheetsWebhook, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(bookingData)
    });

    if (!response.ok) {
      return res.status(500).json({ error: "Google Sheets webhook failed" });
    }

    return res.status(200).json({ status: "ok" });

  } catch (err) {
    console.error("Booking error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
