import "dotenv/config";
import { readFile } from "fs/promises";

import { postEvents } from "./src/UniChatComm/postToUniChat.js";

const DEFAULT_CSV_PATH = "events-crawl-2026-04-26T07-28-14-730Z.csv";

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

    return event;
}

async function run() {
    const csvPath = process.argv[2] ?? DEFAULT_CSV_PATH;
    const csvText = await readFile(csvPath, "utf8");
    const rows = parseCSV(csvText);

    if (rows.length < 2) {
        throw new Error(`CSV file has no data rows: ${csvPath}`);
    }

    const [headers, ...dataRows] = rows;
    const events = dataRows.map(row => mapRowToEvent(headers, row));

    console.log(`Loaded ${events.length} events from ${csvPath}`);
    const result = await postEvents(events);
    console.log("Finished posting CSV events.");
    console.dir(result, { depth: null });
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});