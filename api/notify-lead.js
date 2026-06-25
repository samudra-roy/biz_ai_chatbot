// api/notify-lead.js
// Receives lead data from Apps Script
// Sends WhatsApp to patient + doctor notification

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const {
    patientPhone,
    doctorPhone,
    clinicName,
    fullName,
    treatment,
    howSoon,
    preferredTime,
    source
  } = req.body;

  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;

  if (!PHONE_NUMBER_ID || !WHATSAPP_TOKEN) {
    return res.status(500).json({ error: "WhatsApp credentials not configured" });
  }

  // ---- MESSAGE 1 — Patient confirmation ----
  const patientMessage =
    `Hi *${fullName}*! 👋\n\n` +
    `Thank you for your interest in *${clinicName}*.\n\n` +
    `Our team will call you shortly to confirm your appointment.\n\n` +
    `Meanwhile if you have any questions, just reply here and I'll help you 😊`;

  // ---- MESSAGE 2 — Doctor notification ----
  const doctorMessage =
    `🔔 *New Lead!*\n\n` +
    `*Full Name* - ${fullName}\n` +
    `*Phone* - +${patientPhone}\n` +
    `*Reason* - ${treatment}\n` +
    `*Preferred Appointment Time* - ${preferredTime}\n` +
    `*How soon* - ${howSoon}\n\n` +
    `Please give a call.`;

  try {

    // Send to patient
    await sendWhatsApp(patientPhone, patientMessage, PHONE_NUMBER_ID, WHATSAPP_TOKEN);

    // Send to doctor
    await sendWhatsApp(doctorPhone, doctorMessage, PHONE_NUMBER_ID, WHATSAPP_TOKEN);

    return res.status(200).json({ status: "ok" });

  } catch(err) {
    console.error("notify-lead error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function sendWhatsApp(to, message, phoneNumberId, token) {
  const response = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to:   to,
        type: "text",
        text: { body: message }
      })
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(JSON.stringify(err));
  }

  return response.json();
}
