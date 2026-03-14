import OpenAI from "openai";
import "dotenv/config";

export default class LLM {
    constructor(model = "gpt-4.1-mini") {
        this.model = model;

        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        this.prompt = `
            You are a university student in Edinburgh.
            Your task is to evaluate up to 5 events and decide which ones you would like to go to.

            Return JSON with this exact shape:
            {"selected_indexes":[1,2,5]}

            Rules:
            - Indexes are 1-based.
            - It is okay to choose all events or no events.
            - Only include indexes that exist in the input list.

            Events:
        `;
    }

    buildPrompt(events) {
        return `${this.prompt}${events
            .map((event, idx) => {
                const title = event?.title ?? "Untitled event";
                const location = event?.location ?? "Unknown location";
                const description = event?.description ?? "No description provided";

                return `${idx + 1}. ${title}. Location: ${location}. Description: ${description}.`;
            })
            .join("\n")}`;
    }

    async judge(events) {
        if (!Array.isArray(events)) {
            throw new TypeError("LLM.judge expected an array of events");
        }

        if (events.length === 0) {
            return [];
        }

        const response = await this.client.responses.create({
            model: this.model,
            input: this.buildPrompt(events),
            text: {
                format: {
                    type: "json_schema",
                    name: "event_selection",
                    strict: true,
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            selected_indexes: {
                                type: "array",
                                items: {
                                    type: "integer",
                                    minimum: 1,
                                    maximum: events.length
                                }
                            }
                        },
                        required: ["selected_indexes"]
                    }
                }
            }
        });

        const parsed = JSON.parse(response.output_text);
        const selections = Array.isArray(parsed?.selected_indexes)
            ? parsed.selected_indexes
            : [];

        return selections.filter(
            index =>
                Number.isInteger(index) && index >= 1 && index <= events.length
        );
    }
}