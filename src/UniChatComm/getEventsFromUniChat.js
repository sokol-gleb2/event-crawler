import fetch from "node-fetch";

function extractEvents(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.events)) return payload.events;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
}

export async function getExistingEvents() {
    const allEvents = [];
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
    const events = extractEvents(payload);
    allEvents.push(...events);

    return allEvents;
}
