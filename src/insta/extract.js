import OpenAI from "openai";

const EXTRACTION_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        is_event: { type: "boolean" },
        title: { type: ["string", "null"] },
        one_liner: { type: ["string", "null"] },
        location: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
        date_start: { type: ["string", "null"] },
        time_start: { type: ["string", "null"] },
    },
    required: [
        "is_event",
        "title",
        "one_liner",
        "location",
        "description",
        "date_start",
        "time_start",
    ],
};

export default class InstagramEventExtractor {
    constructor(model = "gpt-4.1-mini") {
        this.model = model;
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    buildPrompt(post) {
        return `
You are extracting structured event data from Instagram posts about Edinburgh.

Decide whether this Instagram post is actually advertising or describing a real event.
Only use the information present in the caption and metadata below.

Return JSON with this exact schema:
- is_event: boolean
- title: string | null
- one_liner: string | null
- location: string | null
- description: string | null
- date_start: string | null in YYYY-MM-DD format when possible
- time_start: string | null in HH:MM format when possible

Rules:
- If the post is not clearly an event, set is_event to false.
- If a field is unknown, return null.
- Keep description concise but useful.
- Do not invent details.
- Only infer a calendar date if the caption makes it reasonably clear.

Post URL: ${post.url}
Owner full name: ${post.ownerFullName}
Caption:
${post.caption}
        `.trim();
    }

    async extractOne(post) {
        const response = await this.client.responses.create({
            model: this.model,
            input: this.buildPrompt(post),
            text: {
                format: {
                    type: "json_schema",
                    name: "instagram_event_extraction",
                    strict: true,
                    schema: EXTRACTION_SCHEMA,
                },
            },
        });

        return JSON.parse(response.output_text);
    }

    async extractMany(posts) {
        if (!Array.isArray(posts)) {
            throw new TypeError("InstagramEventExtractor.extractMany expected an array");
        }

        const extracted = [];

        for (const post of posts) {
            const result = await this.extractOne(post);
            if (!result?.is_event) {
                continue;
            }

            extracted.push({
                caption: post.caption,
                url: post.url,
                ownerFullName: post.ownerFullName,
                image_url: post.image_url ?? null,
                timestamp: post.timestamp ?? null,
                title: result.title,
                one_liner: result.one_liner,
                location: result.location,
                description: result.description,
                date_start: result.date_start,
                time_start: result.time_start,
            });
        }

        return extracted;
    }
}
