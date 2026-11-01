const crypto = require('crypto');
const topicsCache = new Map();

async function handleDocsTopics(req, res, readBody, send, askLLM) {
  try {
    const b = await readBody(req);
    const text = String(b.text || '').trim().slice(0, 12000);
    const hasAttachment = !!(b.attachment && b.attachment.data);

    if (!text && !hasAttachment) {
      return send(res, 400, { error: 'Provide text or an image crop for topic extraction.' });
    }

    const cacheKey = hasAttachment
      ? `att_${crypto.createHash('sha256').update(String(b.attachment.data)).update(text).digest('hex')}`
      : `txt_${crypto.createHash('sha256').update(text).digest('hex')}`;

    if (topicsCache.has(cacheKey)) {
      const cachedTopics = topicsCache.get(cacheKey);
      return send(res, 200, { topics: cachedTopics, visualContext: cachedTopics[0]?.visualContext || '' });
    }

    const system = `You are NeuraLearn's visual-document analyst and curriculum extractor. Carefully inspect the ENTIRE supplied image/crop, not only its largest heading. Read all legible text and identify diagrams, labels, arrows, symbols, equations, tables, axes, legends, annotations, examples, and spatial relationships. Explain what the material is teaching and how its parts connect.
Return ONLY valid JSON matching this schema:
{
  "visualContext": "Detailed grounded description of the full image: subject, purpose, sections, diagram structure, relationships, sequence/causality, labels, equations, values, and important visual details. Clearly mark anything unreadable or uncertain.",
  "topics": [
    {
      "title": "Concise teachable topic title under 60 chars",
      "summary": "What this topic explains and why it matters, up to 300 chars",
      "facts": "Grounded details: definitions, exact formulas, terms, numbers, labels, diagram components and relationships, up to 2200 chars"
    }
  ]
}
Return 3-8 distinct topics when supported; do not invent topics to fill the quota. Preserve exact numbers, units, equations and names. Distinguish observed facts from interpretation. Never treat the title alone as sufficient context. Return pure JSON only.`;

    const userPrompt = hasAttachment
      ? `Analyze the complete uploaded image and extract its teachable concepts, visual structure and exact facts. Use accompanying text as additional context, not as a substitute for inspecting the image:\n${text || '(No OCR text available; inspect the image itself.)'}`
      : `Extract teachable topics and exact facts from this document excerpt:\n${text}`;

    const result = await askLLM(system, userPrompt, 0.1, 2200, {
      thinkingLevel: 'low',
      reasoningEffort: 'low',
      timeoutMs: 25000,
      attachment: b.attachment
    });

    const visualContext = String(result?.visualContext || '').slice(0, 9000);
    let topics = [];
    if (result && Array.isArray(result.topics)) {
      topics = result.topics.map(t => ({
        title: String(t.title || '').slice(0, 60),
        summary: String(t.summary || '').slice(0, 300),
        facts: String(t.facts || t.summary || '').slice(0, 2200),
        visualContext
      })).filter(t => t.title.length > 2);
    }

    if (topics.length) {
      if (topicsCache.size > 80) topicsCache.clear();
      topicsCache.set(cacheKey, topics);
    }

    return send(res, 200, { topics, visualContext });
  } catch (err) {
    return send(res, 500, { error: err.message || 'Topic extraction failed.' });
  }
}

module.exports = { handleDocsTopics };

