import { normaliseEvent } from "../normalise.js";

const SKIDDLE_API_URLS = [
    "https://www.skiddle.com/api/v1/events/search/?radius=10&minDate=2026-06-23&hidecancelled=1&order=date&latitude=55.952&longitude=-3.188&limit=100&pub_key=42f25",
    // "https://www.skiddle.com/api/v1/events/search/?radius=10&minDate=2026-06-05&hidecancelled=1&order=date&latitude=55.952&longitude=-3.188&limit=100&offset=100&pub_key=42f25"
];

function extractExistingLinks(links) {
    return new Set(
        (Array.isArray(links) ? links : [])
            .map(item => {
                if (typeof item === "string") return item.trim();
                if (!item || typeof item !== "object") return null;
                if (typeof item.booking_url === "string") return item.booking_url.trim();
                if (typeof item.url === "string") return item.url.trim();
                if (typeof item.link === "string") return item.link.trim();
                return null;
            })
            .filter(Boolean)
    );
}

function formatPrice(event) {
    const minPrice = event?.ticketpricing?.minPrice;
    const maxPrice = event?.ticketpricing?.maxPrice;
    const currency = event?.currency || event?.eventCurrency || "GBP";
    const formatter = new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        maximumFractionDigits: 2
    });

    if (Number.isFinite(minPrice) && Number.isFinite(maxPrice)) {
        if (minPrice === maxPrice) {
            return formatter.format(minPrice);
        }

        return `${formatter.format(minPrice)} - ${formatter.format(maxPrice)}`;
    }

    if (typeof event?.entryprice === "string" && event.entryprice.trim()) {
        return event.entryprice.trim();
    }

    if (event?.tickets === false) {
        return "No tickets";
    }

    return event?.ticketStatusText || null;
}

function formatLocation(venue) {
    if (!venue || typeof venue !== "object") {
        return null;
    }

    const name = typeof venue.name === "string" ? venue.name.trim() : null;
    const address = typeof venue.address === "string" ? venue.address.trim() : null;
    const town = typeof venue.town === "string" ? venue.town.trim() : null;
    const townAlreadyInAddress =
        Boolean(address && town) && address.toLowerCase().includes(town.toLowerCase());

    return [name, address, townAlreadyInAddress ? null : town]
        .filter(value => typeof value === "string" && value.trim())
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(", ") || null;
}

function toIsoDatePart(value) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    const [datePart] = value.split("T");
    return datePart || null;
}

function toTimePart(value, fallback = null) {
    if (typeof value === "string" && value.includes("T")) {
        const [, timeWithOffset = ""] = value.split("T");
        return timeWithOffset.slice(0, 5) || fallback;
    }

    if (typeof value === "string" && value.trim()) {
        return value.trim().slice(0, 5);
    }

    return fallback;
}

function parseAttendingCount(event) {
    const rawCount = event?.goingtocount ?? event?.goingtos;
    const parsed = Number.parseInt(rawCount, 10);

    return Number.isNaN(parsed) ? null : parsed;
}

function normaliseSkiddleEvent(event) {
    const bookingUrl =
        (typeof event?.link === "string" && event.link.trim()) ||
        null;

    return normaliseEvent({
        title: event?.eventname ?? null,
        one_liner: formatPrice(event),
        image_url:
            event?.xlargeimageurlWebP ||
            event?.xlargeimageurl ||
            event?.largeimageurl ||
            event?.imageurl ||
            null,
        location: formatLocation(event?.venue),
        booking_url: bookingUrl,
        description: event?.description ?? null,
        date_start: toIsoDatePart(event?.startdate) || toIsoDatePart(event?.date),
        time_start: toTimePart(event?.startdate, toTimePart(event?.openingtimes?.doorsopen)),
        attending: parseAttendingCount(event),
        source: "skiddle",
        source_event_id: event?.id ?? event?.listingid ?? bookingUrl
    });
}

async function fetchSkiddlePayload(url) {
    const response = await fetch(url, {
        headers: {
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        throw new Error(`Skiddle request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

function extractResultsFromPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.results)) {
        return payload.results;
    }

    return [];
}

async function readSkiddleResults() {
    const payloads = await Promise.all(SKIDDLE_API_URLS.map(fetchSkiddlePayload));
    const eventsById = new Map();

    for (const payload of payloads) {
        for (const event of extractResultsFromPayload(payload)) {
            const key = event?.id ?? event?.listingid ?? event?.link;

            if (!key || eventsById.has(key)) {
                continue;
            }

            eventsById.set(key, event);
        }
    }

    return [...eventsById.values()];
}

export async function scrapeSkiddle(mode = "discovery", links = []) {
    const events = (await readSkiddleResults()).map(normaliseSkiddleEvent);
    const existingLinks = extractExistingLinks(links);

    if (mode !== "discovery") {
        return events;
    }

    // console.log(events.filter(event => !existingLinks.has(event?.booking_url)));
    return events.filter(event => !existingLinks.has(event?.booking_url));
}