import "dotenv/config";
import { writeFile } from "fs/promises";
import { parse } from "json2csv";

import { scrapeEventbrite } from "./scrappers/eventbrite.js";
import { getExistingEvents } from "./UniChatComm/getEventsFromUniChat.js";
import { postEvents } from "./UniChatComm/postToUniChat.js";
import { scrapeRA } from "./scrappers/ra.js";
import { scrapeRA2 } from "./scrappers/ra2.js";
import { scrapeUniPages } from './scrappers/uni_pages.js'
import { scrapeFixr } from './scrappers/fixr.js'
import LLM from "./llm-judge/LLM.js";

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
    const llm = new LLM();
    const mode = getMode();
    const existingEvents = await getExistingEvents();

    const eventsToAdd = [];
    const eventBriteEvents = await scrapeEventbrite(mode, existingEvents.eventbrite);
    const fixrEvents = await scrapeFixr(mode, existingEvents.fixr ?? []);
    const eventsToCheck = [...eventBriteEvents, ...fixrEvents];
    const chunkSize = 5;

    for (let i = 0; i < eventsToCheck.length; i += chunkSize) {
        const chunk = eventsToCheck.slice(i, i + chunkSize);
        const result = await llm.judge(chunk);
        for (const r of result) eventsToAdd.push(chunk[r-1]);
    }


    const events = [
        ...eventsToAdd,
        ...(await scrapeRA(
            mode,
            existingEvents.ra,
            mode === "discovery" ? 200 : Math.max(existingEvents.ra.length, 100)
        )),
        ...(await scrapeUniPages(mode, existingEvents)),
    ];

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const csvFilename = `events-crawl-${timestamp}.csv`;
    const csv = parse(events);
    await writeFile(csvFilename, csv, "utf8");
    console.log(`Saved CSV: ${csvFilename}`);

    console.log(events.length);
    

    console.log(await postEvents(events));
}

run().catch(console.error);