import Anthropic from "@anthropic-ai/sdk";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

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
            text: `Extract all line items, tax, and tip from this restaurant receipt. Return ONLY a JSON object, no explanation. Format:
{
  "items": [{ "id": "1", "name": "Item Name", "price": 12.50 }, ...],
  "subtotal": 95.00,
  "tax": 8.44,
  "tip": 19.00
}
Rules:
- items should only include food/drink lines, not tax/tip/subtotal/total
- If a line has multiple of the same item (e.g. "Beer x3 ... $18.00"), split into individual entries each at the unit price (3 separate "Beer" items at $6.00 each)
- For items that are clearly one serving (e.g. "Edamame $7.00"), keep as a single entry
- item id should be a simple incrementing string number
- subtotal is the sum of all food/drink items before tax and tip
- tax and tip are the actual dollar amounts from the receipt (use 0 if not present)`,
          },
        ],
      },
    ],
  });

  const text = message.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return res.status(500).json({ error: "Could not parse receipt" });

  try {
    const result = JSON.parse(match[0]);
    res.status(200).json(result);
  } catch {
    res.status(500).json({ error: "Invalid JSON from parser" });
  }
}
