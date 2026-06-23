import "dotenv/config";
import { writeFile } from "fs/promises";
import { normaliseEvent } from "../normalise.js";
import InstagramEventExtractor from "./extract.js";
import { DEFAULT_START_URLS, scrapeEdinburghInstagramPosts } from "./scrapper.js";

function parseCliArgs(argv) {
    const config = {
        startUrls: [],
        limit: 500,
        rawOutput: "edinburgh-instagram-event-posts.raw.json",
        extractedOutput: "edinburgh-instagram-event-posts.extracted.json",
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === "--url") {
            const value = argv[index + 1];
            if (value) {
                config.startUrls.push(value);
                index += 1;
            }
        } else if (arg === "--limit") {
            const value = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(value) && value > 0) {
                config.limit = value;
                index += 1;
            }
        } else if (arg === "--raw-output") {
            const value = argv[index + 1];
            if (value) {
                config.rawOutput = value;
                index += 1;
            }
        } else if (arg === "--extracted-output") {
            const value = argv[index + 1];
            if (value) {
                config.extractedOutput = value;
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

export async function runInstagramEventPipeline({
    startUrls = DEFAULT_START_URLS,
    limit = 500,
    existingUrls = [],
    rawOutput = null,
    extractedOutput = null,
    model = "gpt-4.1-mini",
} = {}) {
    const scrapedPosts = await scrapeEdinburghInstagramPosts({
        startUrls,
        limit,
        existingUrls,
    });

    if (rawOutput) {
        await writeFile(rawOutput, JSON.stringify(scrapedPosts, null, 2), "utf8");
    }

    const extractor = new InstagramEventExtractor(model);
    const extractedEvents = await extractor.extractMany(scrapedPosts);

    if (extractedOutput) {
        await writeFile(extractedOutput, JSON.stringify(extractedEvents, null, 2), "utf8");
    }

    return extractedEvents.map(normaliseInstagramEvent);
}

async function main() {
    const args = parseCliArgs(process.argv.slice(2));
    const startUrls = args.startUrls.length > 0 ? args.startUrls : DEFAULT_START_URLS;

    const events = await runInstagramEventPipeline({
        startUrls,
        limit: args.limit,
        existingUrls: [],
        rawOutput: args.rawOutput,
        extractedOutput: args.extractedOutput,
    });

    console.log(JSON.stringify(events, null, 2));
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
