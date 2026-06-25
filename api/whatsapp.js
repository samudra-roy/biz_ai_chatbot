// api/whatsapp.js
// Handles WhatsApp messages via Meta API
// GET  = webhook verification (one time setup)
// POST = incoming customer messages

// Store conversation history in memory per phone number
// Note: Vercel functions are stateless — history resets if
// function instance restarts. Fine for most conversations.
const conversations = {};
const MAX_HISTORY   = 6;

export default async function handler(req, res) {

  // ---- WEBHOOK VERIFICATION (GET) ----
  // Meta calls this once when you register the webhook
  if (req.method === "GET") {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("WhatsApp webhook verified");
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  }

  // ---- INCOMING MESSAGE (POST) ----
  if (req.method === "POST") {

    // Always respond 200 immediately — Meta retries if no response
    res.status(200).end();

    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return;

      const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message || message.type !== "text") return;

      const customerPhone = message.from;
      const customerText  = message.text.body;
      const phoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

      console.log(`WhatsApp from ${customerPhone}: "${customerText}"`);

      // Get business info for this phone number
      // Each client has their own WhatsApp number
      const businessInfo = getBusinessInfo(phoneNumberId);

      // Build conversation history
      if (!conversations[customerPhone]) conversations[customerPhone] = [];
      conversations[customerPhone].push({ role: "user", content: customerText });
      if (conversations[customerPhone].length > MAX_HISTORY) {
        conversations[customerPhone] = conversations[customerPhone].slice(-MAX_HISTORY);
      }

      // Call Gemini
      const reply = await callGemini(businessInfo, conversations[customerPhone]);

      // Add reply to history
      conversations[customerPhone].push({ role: "assistant", content: reply });

      // Check for booking
      const booking = extractBooking(reply);
      const finalReply = booking
        ? formatBookingConfirmation(booking)
        : reply;

      // Save booking to sheets if detected
      if (booking) {
        const info = CLIENTS[phoneNumberId];
        if (info?.sheetsWebhook) {
          await saveBooking(info.sheetsWebhook, booking, info.name);
        }
      }

      // Send reply back on WhatsApp
      await sendWhatsApp(phoneNumberId, customerPhone, finalReply);

    } catch (err) {
      console.error("WhatsApp error:", err.message);
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}


/* ================================================================
   CLIENT CONFIG
   Add each WhatsApp client here.
   Key = their Meta Phone Number ID (from Meta Developer Dashboard)
   ================================================================ */
const CLIENTS = {

  // Replace with actual Phone Number ID from Meta Dashboard
  "1167174909818379": {
    name:         "DemoClinic Bangalore",
    sheetsWebhook: "https://script.google.com/macros/s/AKfycbw7sD5DfnrThQItJeHiFJ9A2K1PPbuG6m7SS-WtKBUS1JcbKBD1l0tSpoubzzhHgyf5gg/exec",
    info: `
You are a WhatsApp assistant for DemoClinic Dental, Bangalore.
Phone: +919876543210
Timings: Mon-Sat 9am-8pm, Sun 10am-2pm
Services: Cleaning ₹800-1200, Filling ₹500-1500, Root Canal ₹3500-6000

BOOKING: Collect name, 10-digit phone, preferred day and time.
When you have all 4, output exactly:
BOOKING_COMPLETE:name=[name]|phone=[phone]|day=[day]|time=[time]

RULES:
- Reply in same language as customer
- Keep replies SHORT for WhatsApp (2-3 sentences)
- Use *asterisks* for bold (WhatsApp format)
- Never give medical advice
    `
  },

  // Add more clients below:
  // "PHONE_NUMBER_ID_2": { name: "...", sheetsWebhook: "...", info: "..." }
};

function getBusinessInfo(phoneNumberId) {
  return CLIENTS[phoneNumberId]?.info || "You are a helpful business assistant.";
}


/* ================================================================
   SHARED HELPERS
   ================================================================ */

async function callGemini(systemPrompt, messages) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map(m => ({
          role:  m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }))
      })
    }
  );
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function sendWhatsApp(phoneNumberId, to, text) {
  await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      })
    }
  );
}

function extractBooking(reply) {
  if (!reply.includes("BOOKING_COMPLETE:")) return null;
  try {
    const raw   = reply.split("BOOKING_COMPLETE:")[1].trim();
    const parts = {};
    raw.split("|").forEach(p => {
      const [key, val] = p.split("=");
      parts[key.trim()] = val?.trim();
    });
    if (parts.phone) {
      parts.phone = parts.phone
        .replace(/\s+/g, "").replace(/-/g, "")
        .replace(/^\+91/, "").replace(/^91(\d{10})$/, "$1");
    }
    return (parts.name && parts.phone && parts.day && parts.time) ? parts : null;
  } catch(e) { return null; }
}

function formatBookingConfirmation(booking) {
  return (
    `✅ *Booking recorded!*\n\n` +
    `*Name:* ${booking.name}\n` +
    `*Phone:* ${booking.phone}\n` +
    `*Day:* ${booking.day}\n` +
    `*Time:* ${booking.time}\n\n` +
    `Our team will confirm your appointment shortly! 😊`
  );
}

async function saveBooking(sheetsWebhook, booking, businessName) {
  try {
    await fetch(sheetsWebhook, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        ...booking,
        business: businessName
      })
    });
  } catch(e) {
    console.error("Sheets save failed:", e.message);
  }
}
