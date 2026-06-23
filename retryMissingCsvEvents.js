import "dotenv/config";
import { readFile } from "fs/promises";

import { getExistingEvents } from "./src/UniChatComm/getEventsFromUniChat.js";
import { postEvents } from "./src/UniChatComm/postToUniChat.js";
import { normaliseEvent } from "./src/normalise.js";

const DEFAULT_CSV_PATH = "events-crawl-2026-06-22T20-22-55-778Z.csv";
const TRACKING_PARAMS = new Set([
    "aff",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
]);

function parseCliArgs(argv) {
    const config = {
        csvPath: DEFAULT_CSV_PATH,
        dryRun: false,
        includeUnlistedSources: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "--dry-run") {
            config.dryRun = true;
            continue;
        }

        if (arg === "--include-unlisted-sources") {
            config.includeUnlistedSources = true;
            continue;
        }

        if (!arg.startsWith("-")) {
            config.csvPath = arg;
        }
    }

    return config;
}

function parseCSV(csvText) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i += 1) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                value += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === "," && !inQuotes) {
            row.push(value);
            value = "";
            continue;
        }

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && nextChar === "\n") {
                i += 1;
            }

            row.push(value);
            value = "";

            if (row.some(cell => cell !== "")) {
                rows.push(row);
            }

            row = [];
            continue;
        }

        value += char;
    }

    if (value.length > 0 || row.length > 0) {
        row.push(value);
        if (row.some(cell => cell !== "")) {
            rows.push(row);
        }
    }

    return rows;
}

function mapRowToEvent(headers, row) {
    const event = {};

    for (let i = 0; i < headers.length; i += 1) {
        const key = headers[i];
        const rawValue = row[i] ?? "";
        event[key] = rawValue === "" ? null : rawValue;
    }

    if (event.attending !== null) {
        const attendingNumber = Number(event.attending);
        event.attending = Number.isNaN(attendingNumber) ? event.attending : attendingNumber;
    }

    return normaliseEvent(event);
}

function normaliseLink(link) {
    if (typeof link !== "string") return null;

    const trimmed = link.trim();
    if (!trimmed) return null;

    try {
        const url = new URL(trimmed);
        url.hash = "";

        for (const key of [...url.searchParams.keys()]) {
            if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) {
                url.searchParams.delete(key);
            }
        }

        const pathname = url.pathname.replace(/\/+$/, "");
        url.pathname = pathname || "/";

        return url.toString();
    } catch {
        return trimmed.replace(/\/+$/, "");
    }
}

function getEventLink(event) {
    return event?.booking_url ?? event?.source_event_id ?? null;
}

function groupExistingLinks(existingEvents) {
    const grouped = {};

    for (const [source, links] of Object.entries(existingEvents ?? {})) {
        grouped[source] = new Set(
            (Array.isArray(links) ? links : [])
                .map(normaliseLink)
                .filter(Boolean)
        );
    }

    return grouped;
}

function flattenExistingLinks(existingLinksBySource) {
    const allLinks = new Set();

    for (const links of Object.values(existingLinksBySource)) {
        for (const link of links) {
            allLinks.add(link);
        }
    }

    return allLinks;
}

function countBySource(events) {
    return events.reduce((counts, event) => {
        const source = event?.source ?? "unknown";
        counts[source] = (counts[source] ?? 0) + 1;
        return counts;
    }, {});
}

async function main() {
    const { csvPath, dryRun, includeUnlistedSources } = parseCliArgs(process.argv.slice(2));
    const csvText = await readFile(csvPath, "utf8");
    const rows = parseCSV(csvText);

    if (rows.length < 2) {
        throw new Error(`CSV file has no data rows: ${csvPath}`);
    }

    const [headers, ...dataRows] = rows;
    const events = dataRows.map(row => mapRowToEvent(headers, row));
    const existingEvents = await getExistingEvents();
    const existingLinksBySource = groupExistingLinks(existingEvents);
    const allExistingLinks = flattenExistingLinks(existingLinksBySource);
    const skippedEvents = [];
    const missingEvents = events.filter(event => {
        const source = event?.source ?? "other";
        const eventLink = normaliseLink(getEventLink(event));

        if (!existingLinksBySource[source] && !includeUnlistedSources) {
            skippedEvents.push(event);
            return false;
        }

        if (!eventLink) return true;

        if (allExistingLinks.has(eventLink)) {
            return false;
        }

        return !existingLinksBySource[source]?.has(eventLink);
    });

    console.log(`Loaded ${events.length} events from ${csvPath}`);
    console.log(`Found ${missingEvents.length} missing events`);
    console.dir(countBySource(missingEvents), { depth: null });

    if (skippedEvents.length > 0) {
        console.log("Skipped events for sources missing from getExistingEvents. Use --include-unlisted-sources to force them.");
        console.dir(countBySource(skippedEvents), { depth: null });
    }

    if (missingEvents.length === 0) {
        console.log("Nothing to repost.");
        return;
    }

    if (dryRun) {
        console.log("Dry run enabled. Skipping backend repost.");
        return;
    }

    const result = await postEvents(missingEvents);
    console.log("Finished reposting missing CSV events.");
    console.dir(result, { depth: null });
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
