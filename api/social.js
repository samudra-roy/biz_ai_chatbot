// api/social.js
// Handles BOTH Instagram DMs and Facebook Messenger
// One endpoint for both platforms — Meta sends both here
// GET  = webhook verification
// POST = incoming messages from either platform

const conversations = {};
const MAX_HISTORY   = 6;

export default async function handler(req, res) {

  // ---- WEBHOOK VERIFICATION (GET) ----
  if (req.method === "GET") {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("Social webhook verified");
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  }

  // ---- INCOMING MESSAGE (POST) ----
  if (req.method === "POST") {

    res.status(200).end();

    try {
      const body     = req.body;
      const platform = body.object; // "instagram" or "page"

      if (platform !== "instagram" && platform !== "page") return;

      for (const entry of body.entry || []) {
        const pageId = entry.id;

        for (const event of entry.messaging || []) {
          await handleMessage(event, pageId, platform);
        }
      }

    } catch (err) {
      console.error("Social webhook error:", err.message);
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}


/* ================================================================
   CLIENT CONFIG
   Key = Facebook Page ID
   Find it: Facebook Page → About → Page ID
   ================================================================ */
const CLIENTS = {

  // Replace with actual Facebook Page ID
  "YOUR_FACEBOOK_PAGE_ID": {
    name:          "DemoClinic Bangalore",
    sheetsWebhook: "YOUR_APPS_SCRIPT_URL",
    info: `
You are an Instagram/Facebook assistant for DemoClinic Dental, Bangalore.
Phone: +91 XXXXX XXXXX
Timings: Mon-Sat 9am-8pm, Sun 10am-2pm
Services: Cleaning ₹800-1200, Filling ₹500-1500, Root Canal ₹3500-6000

BOOKING: Collect name, 10-digit phone, preferred day and time.
When you have all 4, output exactly:
BOOKING_COMPLETE:name=[name]|phone=[phone]|day=[day]|time=[time]

RULES:
- Keep replies SHORT and friendly (2-3 sentences max)
- Reply in same language as customer
- Never give medical advice
- Use emojis occasionally to keep it warm
    `
  },

  // Add more clients:
  // "PAGE_ID_2": { name: "...", sheetsWebhook: "...", info: "..." }
};


/* ================================================================
   CORE MESSAGE HANDLER
   ================================================================ */

async function handleMessage(event, pageId, platform) {

  // Skip echoes and non-text messages
  if (!event.message || event.message.is_echo) return;

  if (!event.message.text) {
    await sendSocialReply(
      event.sender.id,
      "Hi! I can only read text messages. Please type your question 😊",
      platform
    );
    return;
  }

  const senderId    = event.sender.id;
  const messageText = event.message.text;
  const client      = CLIENTS[pageId];
  const businessInfo = client?.info || "You are a helpful assistant.";

  console.log(`[${platform}] From ${senderId}: "${messageText}"`);

  // Build history
  if (!conversations[senderId]) conversations[senderId] = [];
  conversations[senderId].push({ role: "user", content: messageText });
  if (conversations[senderId].length > MAX_HISTORY) {
    conversations[senderId] = conversations[senderId].slice(-MAX_HISTORY);
  }

  // Call Gemini
  const reply = await callGemini(businessInfo, conversations[senderId]);
  conversations[senderId].push({ role: "assistant", content: reply });

  // Check for booking
  const booking = extractBooking(reply);
  const finalReply = booking
    ? formatBookingConfirmation(booking)
    : reply;

  // Save booking
  if (booking && client?.sheetsWebhook) {
    await saveBooking(client.sheetsWebhook, booking, client.name);
  }

  // Send reply
  await sendSocialReply(senderId, finalReply, platform);
}


async function sendSocialReply(recipientId, text, platform) {
  try {
    await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient:      { id: recipientId },
          message:        { text },
          messaging_type: "RESPONSE"
        })
      }
    );
  } catch(e) {
    console.error(`Send reply error [${platform}]:`, e.message);
  }
}


/* ================================================================
   SHARED HELPERS (same as whatsapp.js)
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
    `✅ Booking recorded!\n\n` +
    `Name: ${booking.name}\n` +
    `Phone: ${booking.phone}\n` +
    `Day: ${booking.day}\n` +
    `Time: ${booking.time}\n\n` +
    `Our team will confirm shortly! 😊`
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
