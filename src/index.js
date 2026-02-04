import "dotenv/config";

import { scrapeEventbrite } from "./scrappers/eventbrite.js";
import { getExistingEvents } from "./UniChatComm/getEventsFromUniChat.js";
import { postEvents } from "./UniChatComm/postToUniChat.js";
import { scrapeRA } from "./scrappers/ra.js";
import { scrapeUniPages } from './scrappers/uni_pages.js'

function getMode() {
    const directArg = process.argv.slice(2).find(arg => !arg.startsWith("-"));
    if (directArg) return directArg.toLowerCase();

    const npmArgvRaw = process.env.npm_config_argv;
    if (!npmArgvRaw) return null;

    try {
        const parsed = JSON.parse(npmArgvRaw);
        const original = Array.isArray(parsed?.original) ? parsed.original : [];
        const fallback = original.find(arg => arg === "discovery" || arg === "refresh");
        return fallback ?? null;
    } catch {
        return null;
    }
}

async function run() {
    const mode = getMode();
    // const existingEvents = await getExistingEvents();
    const existingEvents = {eventbrite: [], ra: []};

    const events = [
        ...(await scrapeEventbrite(mode, existingEvents.eventbrite)),
        ...(await scrapeRA(mode, existingEvents, mode==="discovery" ? 200 : existingEvents.ra.length())),
        // ...(await scrapeUniPages(mode, existingEvents))
    ];

    console.log(events);
    

    console.log(await postEvents(events));
}

run().catch(console.error);
