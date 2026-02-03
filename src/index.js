import { scrapeEventbrite } from "./scrappers/eventbrite.js";
import { getExistingEvents } from "./UniChatComm/getEventsFromUniChat.js";
import { postEvents } from "./UniChatComm/postToUniChat.js";
// import { scrapeRA } from "./scrappers/ra.js";
import { scrapeRA } from "./scrappers/ra2.js";

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
    // const mode = getMode();
    // const existingEvents = getExistingEvents();

    const events = [
        // ...(await scrapeEventbrite(mode, existingEvents.eventbrite)),
        ...(await scrapeRA(10))
    ];

    console.log(events);
    

    // await postEvents(events);
}

run().catch(console.error);
