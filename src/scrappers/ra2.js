import fs from "node:fs";
import { normaliseEvent } from "../normalise.js";

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === "\"") {
                const next = text[i + 1];
                if (next === "\"") {
                    field += "\"";
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === "\"") {
            inQuotes = true;
        } else if (char === ",") {
            row.push(field);
            field = "";
        } else if (char === "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else if (char !== "\r") {
            field += char;
        }
    }

    if (field.length || row.length) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

function safeJsonParse(value) {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function splitIso(value) {
    if (!value || typeof value !== "string") return { date_start: null, time_start: null };
    const [datePart, timePartRaw] = value.split("T");
    return {
        date_start: datePart || null,
        time_start: timePartRaw || null
    };
}

export async function scrapeRA2(csvPath = "edinburgh-events.csv") {
    const raw = fs.readFileSync(csvPath, "utf8");
    const rows = parseCsv(raw);

    if (!rows.length) return [];
    const headers = rows.shift();
    const events = [];

    for (const row of rows) {
        if (!row.length) continue;

        const data = {};
        headers.forEach((header, idx) => {
            data[header] = row[idx] ?? "";
        });

        const images = safeJsonParse(data.images);
        const venue = safeJsonParse(data.venue);
        const promotionalLinks = safeJsonParse(data.promotionalLinks);

        const flyerFront =
            Array.isArray(images)
                ? images.find(image => image?.type === "FLYERFRONT")?.filename
                : null;

        const { date_start } = splitIso(data.date);
        const { time_start } = splitIso(data.startTime);

        const promotionalText = Array.isArray(promotionalLinks) && promotionalLinks.length
            ? `\n\n Uni-Chat finds... \nTry here for discounted price: \n${promotionalLinks
                .map(link => [link?.title, link?.url].filter(Boolean).join(": "))
                .filter(Boolean)
                .join("\n")}`
            : "";

        const description = `${data.content || ""}${promotionalText}` || null;

        events.push(
            normaliseEvent({
                title: data.title || null,
                one_liner: data.cost || null,
                description,
                image_url: flyerFront || data.flyerFront || null,
                location: [venue?.name, venue?.address].filter(Boolean).join(", ") || null,
                booking_url: data.contentUrl ? `https://ra.co/${data.contentUrl}` : null,
                date_start,
                time_start,
                source: "ra",
                source_event_id:
                    data.id || (data.contentUrl ? `https://ra.co/${data.contentUrl}` : null),
                attending: data.interestedCount || null
            })
        );
    }

    return events;
}
