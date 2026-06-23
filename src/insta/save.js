import "dotenv/config";
import { readFile } from "fs/promises";
import { postEvents } from "../UniChatComm/postToUniChat.js";
import { normaliseEvent } from "../normalise.js";

function parseCliArgs(argv) {
    const config = {
        input: "edinburgh-instagram-event-posts.extracted.json",
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === "--input") {
            const value = argv[index + 1];
            if (value) {
                config.input = value;
                index += 1;
            }
        }
    }

    return config;
}

function normaliseInstagramEvent(event) {
    return normaliseEvent({
        title: event.title,
        one_liner: event.one_liner,
        image_url: event.image_url,
        location: event.location,
        booking_url: event.url,
        description: event.description,
        date_start: event.date_start,
        time_start: event.time_start,
        source: "instagram",
        source_event_id: event.url,
    });
}

export async function saveInstagramEvents(input = "edinburgh-instagram-event-posts.extracted.json") {
    const fileContents = await readFile(input, "utf8");
    const extractedEvents = JSON.parse(fileContents);

    if (!Array.isArray(extractedEvents)) {
        throw new TypeError("Expected extracted Instagram events JSON to contain an array.");
    }

    const events = extractedEvents.map(normaliseInstagramEvent);
    return postEvents(events);
}

async function main() {
    const args = parseCliArgs(process.argv.slice(2));
    const result = await saveInstagramEvents(args.input);
    console.log(result);
}

const isDirectExecution =
    process.argv[1] &&
    new URL(`file://${process.argv[1]}`).href === import.meta.url;

if (isDirectExecution) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}