import Anthropic from "@anthropic-ai/sdk";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { imageBase64, mediaType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: "No image provided" });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 },
          },
          {
            type: "text",
            text: `Extract all line items from this restaurant receipt. Return ONLY a JSON array, no explanation. Format:
[{ "id": "1", "name": "Item Name", "price": 12.50 }, ...]
- Exclude tax, tip, subtotal, total lines
- Use the actual menu item names
- Price should be the total for that line (e.g. if it's "x2" multiply it out)
- id should be a simple incrementing string number`,
          },
        ],
      },
    ],
  });

  const text = message.content[0].text.trim();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return res.status(500).json({ error: "Could not parse receipt" });

  try {
    const items = JSON.parse(match[0]);
    res.status(200).json({ items });
  } catch {
    res.status(500).json({ error: "Invalid JSON from parser" });
  }
}
