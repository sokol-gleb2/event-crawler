import fetch from "node-fetch";

function toGroupedEvents(payload) {
    if (payload?.events && typeof payload.events === "object" && !Array.isArray(payload.events)) {
        return payload.events;
    }

    const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.events)
          ? payload.events
          : Array.isArray(payload?.data)
            ? payload.data
            : [];

    const grouped = {};
    for (const item of list) {
        if (typeof item === "string") {
            grouped.other ??= [];
            grouped.other.push(item);
            continue;
        }
        if (!item || typeof item !== "object") continue;
        const source = item.source || "other";
        const link = item.booking_link || item.booking_url || item.url || item.link || null;
        if (!link) continue;
        grouped[source] ??= [];
        grouped[source].push(link);
    }

    return grouped;
}

export async function getExistingEvents() {
    const url = new URL(`https://www.uni-chat.com/api/events/getExistingEvents`);

    const res = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CRAWLER_KEY}`
        }
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch existing events (${res.status})`);
    }
    
    const payload = await res.json();
    if (payload.result === "failure") {
        throw new Error(`Failed to fetch existing events (${res.status})`);
    }

    return toGroupedEvents(payload);
}
