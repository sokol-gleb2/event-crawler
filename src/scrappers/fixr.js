import fs from "node:fs";

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

export function scrapeFixr(mode = "discovery", links = []) {
    const fileUrl = new URL("../docs/fixrData.json", import.meta.url);
    const events = JSON.parse(fs.readFileSync(fileUrl, "utf8"));
    const existingLinks = extractExistingLinks(links);

    if (mode !== "discovery") {
        return events;
    }

    return events.filter(event => !existingLinks.has(event?.booking_url));
}