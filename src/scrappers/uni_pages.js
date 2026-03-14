// page.goto: Timeout 30000ms exceeded.
// Call log:
//   - navigating to "https://edinburghnapier.native.fm/event/scavanger-hunt-social/277144", waiting until "networkidle"

//     at scrapeNativeListing (/Applications/XAMPP/xamppfiles/htdocs/uni-chat/event_crawler/src/scrappers/uni_pages.js:299:20)
//     at async scrapeUniPages (/Applications/XAMPP/xamppfiles/htdocs/uni-chat/event_crawler/src/scrappers/uni_pages.js:436:17)
//     at async run (/Applications/XAMPP/xamppfiles/htdocs/uni-chat/event_crawler/src/index.js:34:13) {
//   name: 'TimeoutError'
// }

import { chromium } from "playwright";
import axios from "axios";
import { load } from "cheerio";
import { mkdir, writeFile } from "fs/promises";
import { normaliseEvent } from "../normalise.js";

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const MONTHS = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12
};

function pad2(value) {
    return String(value).padStart(2, "0");
}

function toIsoDate(year, month, day) {
    if (!year || !month || !day) return null;
    return `${year}-${pad2(month)}-${pad2(day)}`;
}

function extractExistingLinks(links, source) {
    const list = Array.isArray(links)
        ? links
        : Array.isArray(links?.events)
          ? links.events
          : [];

    return new Set(
        list
            .filter(item => (source ? item?.source === source : true))
            .map(item => {
                if (typeof item === "string") return item.trim();
                if (!item || typeof item !== "object") return null;
                if (typeof item.booking_url === "string") return item.booking_url.trim();
                if (typeof item.url === "string") return item.url.trim();
                if (typeof item.link === "string") return item.link.trim();
                if (typeof item.source_event_id === "string") return item.source_event_id.trim();
                return null;
            })
            .filter(Boolean)
    );
}

function splitIsoDateTime(value) {
    if (!value || typeof value !== "string") return { date_start: null, time_start: null };
    const [datePart, timePartRaw] = value.split("T");
    if (!timePartRaw) return { date_start: datePart || null, time_start: null };
    const timePart = timePartRaw.replace("Z", "");
    return { date_start: datePart || null, time_start: timePart || null };
}

function parseTimeTo24h(value) {
    if (!value || typeof value !== "string") return null;
    const cleaned = value.trim().toLowerCase();
    if (cleaned === "noon") return "12:00";
    if (cleaned === "midnight") return "00:00";
    const match = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = match[2] ?? "00";
    const meridiem = match[3];
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return `${pad2(hour)}:${minute}`;
}

function extractDateFromHeader(text, fallbackYear) {
    if (!text) return null;
    const match = text
        .toLowerCase()
        .match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = MONTHS[match[2]];
    if (!day || !month) return null;
    return toIsoDate(fallbackYear, month, day);
}

function absoluteUrl(base, href) {
    try {
        return new URL(href, base).toString();
    } catch {
        return href;
    }
}

function extractEventFromJsonLdObject(obj) {
    if (!obj || typeof obj !== "object") return [];
    const events = [];
    const queue = [obj];
    while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== "object") continue;

        const types = Array.isArray(current["@type"])
            ? current["@type"]
            : [current["@type"]].filter(Boolean);
        if (types.some(type => String(type).toLowerCase() === "event")) {
            events.push(current);
            continue;
        }

        if (current["@type"] === "ItemList" && Array.isArray(current.itemListElement)) {
            current.itemListElement.forEach(item => {
                if (item?.item) queue.push(item.item);
                else queue.push(item);
            });
        }

        Object.values(current).forEach(value => {
            if (Array.isArray(value)) value.forEach(entry => queue.push(entry));
            else if (value && typeof value === "object") queue.push(value);
        });
    }
    return events;
}

function normaliseFromSchemaEvent(eventData, source, fallbackUrl) {
    const image = Array.isArray(eventData?.image)
        ? eventData.image[0]
        : eventData?.image;

    const location =
        typeof eventData?.location === "string"
            ? eventData.location
            : eventData?.location?.name ||
              [
                  eventData?.location?.name,
                  eventData?.location?.address?.streetAddress,
                  eventData?.location?.address?.addressLocality
              ]
                  .filter(Boolean)
                  .join(", ");

    const { date_start, time_start } = splitIsoDateTime(eventData?.startDate);

    return normaliseEvent({
        title: eventData?.name ?? eventData?.headline,
        description: eventData?.description,
        image_url: image ?? null,
        location: location || null,
        booking_url: eventData?.url ?? fallbackUrl,
        date_start,
        time_start,
        one_liner: eventData?.offers?.price
            ? `${eventData.offers.price}${eventData.offers.priceCurrency ? ` ${eventData.offers.priceCurrency}` : ""}`
            : null,
        source,
        source_event_id: eventData?.["@id"] ?? eventData?.url ?? fallbackUrl
    });
}

async function extractEventsFromPage(page, source, fallbackUrl) {
    const events = [];
    const data = await page.evaluate(() => {
        const parsed = Array.from(
            document.querySelectorAll('script[type="application/ld+json"]')
        )
            .map(script => script.textContent?.trim())
            .filter(Boolean)
            .flatMap(raw => {
                try {
                    return [JSON.parse(raw)];
                } catch {
                    return [];
                }
            });

        const og = {
            title: document.querySelector('meta[property="og:title"]')?.content || null,
            description:
                document.querySelector('meta[property="og:description"]')?.content || null,
            image: document.querySelector('meta[property="og:image"]')?.content || null,
            url: document.querySelector('meta[property="og:url"]')?.content || null
        };

        const fallback = {
            title: document.querySelector("h1")?.textContent?.trim() || null,
            description: document.querySelector("main")?.textContent?.trim() || null,
            image: og.image,
            url: og.url
        };

        const time =
            document.querySelector("time[datetime]")?.getAttribute("datetime") ||
            document.querySelector("[data-start-date]")?.getAttribute("data-start-date") ||
            null;

        return { parsed, og, fallback, time };
    });

    for (const entry of data.parsed) {
        const candidates = extractEventFromJsonLdObject(entry);
        for (const candidate of candidates) {
            events.push(normaliseFromSchemaEvent(candidate, source, fallbackUrl));
        }
    }

    if (events.length) return events;

    if (data.fallback.title || data.og.title) {
        const { date_start, time_start } = splitIsoDateTime(data.time);
        return [
            normaliseEvent({
                title: data.og.title ?? data.fallback.title,
                description: data.og.description ?? data.fallback.description,
                image_url: data.og.image ?? data.fallback.image,
                booking_url: data.og.url ?? fallbackUrl,
                date_start,
                time_start,
                source,
                source_event_id: data.og.url ?? fallbackUrl
            })
        ];
    }

    return [];
}

async function clickLoadMore(page, selectors, maxClicks = 20) {
    for (let i = 0; i < maxClicks; i++) {
        const button = page.locator(selectors).first();
        if (!(await button.isVisible().catch(() => false))) break;
        const countBefore = await page
            .evaluate(() => document.querySelectorAll("a[href]").length)
            .catch(() => 0);
        await button.click().catch(() => null);
        await page.waitForTimeout(1200);
        const countAfter = await page
            .evaluate(() => document.querySelectorAll("a[href]").length)
            .catch(() => 0);
        if (countAfter <= countBefore) break;
    }
}

async function collectLinks(page, hostIncludes, pathIncludes) {
    const links = await page.evaluate(
        ({ hostIncludes, pathIncludes }) => {
            const urls = [];
            const anchors = Array.from(document.querySelectorAll("a[href]"));
            for (const anchor of anchors) {
                try {
                    const url = new URL(anchor.href, window.location.href);
                    if (
                        hostIncludes.length &&
                        !hostIncludes.some(host => url.hostname.includes(host))
                    ) {
                        continue;
                    }
                    if (
                        pathIncludes.length &&
                        !pathIncludes.some(path => url.pathname.includes(path))
                    ) {
                        continue;
                    }
                    urls.push(url.toString());
                } catch {}
            }
            return Array.from(new Set(urls));
        },
        { hostIncludes, pathIncludes }
    );

    return links;
}

function splitApiDateTime(value) {
    if (!value || typeof value !== "string") {
        return { date_start: null, time_start: null };
    }

    const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/);
    if (!match) return splitIsoDateTime(value);

    return {
        date_start: match[1],
        time_start: match[2]
    };
}

function buildNativeBookingUrl(baseUrl, slug, id) {
    if (!slug || !id) return null;
    return absoluteUrl(baseUrl, `/event/${slug}/${id}`);
}

function buildNativeOneLiner(event) {
    const parts = [];
    const price =
        event?.priceFrom != null && event?.currency?.format
            ? `${event.currency.format}${event.priceFrom}`
            : null;
    const categoryNames = Array.isArray(event?.categories)
        ? event.categories.map(category => category?.name).filter(Boolean)
        : [];
    const promoter = event?.promoterGroup?.name || null;

    if (price) parts.push(price);
    if (promoter) parts.push(promoter);
    if (categoryNames.length) parts.push(categoryNames.join(", "));

    return parts.length ? parts.join(" | ") : null;
}

function cleanNativeDescriptionText(value) {
    if (!value || typeof value !== "string") return null;

    const lines = value
        .replace(/\u00a0/g, " ")
        .split("\n")
        .map(line => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    return lines.length ? lines.join("\n") : null;
}

function extractNativeDescription(html) {
    if (!html || typeof html !== "string") return null;

    const $ = load(html);
    const container = $(
        ".MuiGrid-root.MuiGrid-item.MuiGrid-grid-xs-12.MuiGrid-grid-md-6"
    ).eq(3);

    if (!container.length) return null;

    const parts = container
        .children("div")
        .map((_, element) => cleanNativeDescriptionText($(element).text()))
        .get()
        .filter(Boolean);

    return parts.length ? parts.join("\n\n") : null;
}

async function scrapeNativeListing(page, baseUrl, source, existingLinks, buttonText) {
    void page;
    void buttonText;

    const today = new Date().toISOString().slice(0, 10);
    const deploymentId = "82";
    let nextPage = 1;
    const events = [];

    while (nextPage) {
        const apiUrl = `https://api.native.fm/api/deployment/v1/${deploymentId}/events/?filter=&from=${today}&page=${nextPage}&perPage=100`;
        const response = await axios.get(apiUrl, {
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "application/json"
            }
        });

        const pageEvents = Array.isArray(response.data?.data) ? response.data.data : [];
        for (const event of pageEvents) {
            const bookingUrl = buildNativeBookingUrl(baseUrl, event?.slug, event?.id);
            if (
                existingLinks &&
                existingLinks.size &&
                ((bookingUrl && existingLinks.has(bookingUrl)) ||
                    (event?.id != null && existingLinks.has(String(event.id))))
            ) {
                continue;
            }

            const { date_start, time_start } = splitApiDateTime(event?.startAt);
            const categoryNames = Array.isArray(event?.categories)
                ? event.categories.map(category => category?.name).filter(Boolean)
                : [];
            let description = categoryNames.length ? categoryNames.join(", ") : null;

            if (bookingUrl) {
                try {
                    const detailResponse = await axios.get(bookingUrl, {
                        headers: {
                            "User-Agent": USER_AGENT,
                            Accept: "text/html,application/xhtml+xml"
                        }
                    });
                    description = extractNativeDescription(detailResponse.data) || description;
                } catch {}
            }

            events.push(
                normaliseEvent({
                    title: event?.name,
                    one_liner: buildNativeOneLiner(event),
                    image_url: event?.eventLargePhotoUrl || event?.eventPhotoUrl || event?.largePhoto,
                    location: event?.eventPlace || null,
                    booking_url: bookingUrl,
                    description,
                    date_start,
                    time_start,
                    source,
                    source_event_id: bookingUrl || String(event?.id ?? "")
                })
            );
        }

        nextPage = Number.isInteger(response.data?.nextPage) ? response.data.nextPage : null;
    }

    return events;
}

async function extractEventsFromEUSAPage(page, link) {
    const data = await page.evaluate(() => {
        const text = selector =>
            document.querySelector(selector)?.textContent?.trim() || null;
        const attr = (selector, name) =>
            document.querySelector(selector)?.getAttribute(name)?.trim() || null;
        const attrSelectLast = (selector, name) =>
            document.querySelectorAll(selector)[document.querySelectorAll(selector).length-1]?.getAttribute(name)?.trim() || null;
        const to24hWithSeconds = value => {
            if (!value) return null;
            const cleaned = value.trim().toLowerCase();
            const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
            if (!match) return null;
            let hour = Number(match[1]);
            const minute = match[2] ?? "00";
            const meridiem = match[3];
            if (meridiem === "pm" && hour !== 12) hour += 12;
            if (meridiem === "am" && hour === 12) hour = 0;
            return `${String(hour).padStart(2, "0")}:${minute}:00`;
        };
        const parseStartTimeFromTimeText = value => {
            if (!value) return null;
            const parts = value.trim().split(" | ");
            if (parts.length < 2) return null;
            const range = parts[1].split(" - ");
            if (!range.length) return null;
            return to24hWithSeconds(range[0]);
        };
        const parseDate = value => {
            if (!value) return null;
            const match = value.match(/^\d{4}-\d{2}-\d{2}/);
            return match ? match[0] : null;
        };

        const dateRows = Array.from(document.querySelectorAll(".row.event-date-card")).map(
            row => {
                const datetimeRaw =
                    row.querySelector("time[datetime]")?.getAttribute("datetime")?.trim() ||
                    null;
                const timeText = row.querySelector("time[datetime]")?.textContent || null;
                return {
                    one_liner:
                        row.querySelector("p.mb-1.g-font-size-16")?.textContent?.trim() ||
                        null,
                    date_start: parseDate(datetimeRaw),
                    time_start: parseStartTimeFromTimeText(timeText),
                    location:
                        row.querySelector("p.g-font-weight-300.mb-0")?.textContent?.trim() ||
                        null
                };
            }
        );

        const fallbackTimeText = document.querySelector("time[datetime]")?.textContent || null;

        return {
            title: text("h1.h1"),
            one_liner: text(".g-font-size-16 p"),
            image_url: attrSelectLast(".container article img.img-fluid", "src"),
            description: text(".g-font-size-16"),
            date_start: parseDate(attr("time[datetime]", "datetime")),
            time_start: parseStartTimeFromTimeText(fallbackTimeText),
            location: text("time[datetime] + p.g-font-weight-300.mb-0"),
            dateRows,
        };
    });

    if (!data.title && !data.description) return [];

    if (data.dateRows.length) {
        return data.dateRows.map((row, idx) =>
            normaliseEvent({
                title: data.title,
                one_liner: row.one_liner ?? data.one_liner,
                image_url: absoluteUrl(link, data.image_url),
                booking_url: link,
                description: data.description,
                date_start: row.date_start,
                time_start: row.time_start,
                location: row.location ?? data.location,
                source: "eusa",
                source_event_id: row.date_start ? `${link}#${row.date_start}` : `${link}#${idx}`
            })
        );
    }

    return [
        normaliseEvent({
            title: data.title,
            one_liner: data.one_liner,
            image_url: absoluteUrl(link, data.image_url),
            booking_url: link,
            description: data.description,
            date_start: data.date_start,
            time_start: data.time_start,
            location: data.location,
            source: "eusa",
            source_event_id: link
        })
    ];
}

async function scrapeEusa(page, existingLinks) {
    const baseUrl = "https://www.eusa.ed.ac.uk/events";
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await clickLoadMore(
        page,
        `button:has-text("See More"), button:has-text("See more"), a:has-text("See More"), a:has-text("See more")`
    );

    const links = (await collectLinks(page, ["eusa.ed.ac.uk"], ["/events/"])).filter(
        link => link !== baseUrl && link !== `${baseUrl}/`
    );
    const linksToCrawl =
        existingLinks && existingLinks.size
            ? links.filter(link => !existingLinks.has(link))
            : links;

    const events = [];
    for (const link of linksToCrawl) {
        await page.goto(link, { waitUntil: "networkidle" });
        const details = await extractEventsFromEUSAPage(page, link);
        if (details.length) events.push(...details);
    }

    return events;
}

function extractHwEvents(html, year, baseUrl) {
    const $ = load(html);
    const events = [];

    $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        if (!href.includes("native.fm")) return;

        const title = $(el).text().trim();
        if (!title) return;

        const dateHeaderText = $(el).prevAll("h4").first().text().trim();
        const date_start = extractDateFromHeader(dateHeaderText, year);

        const details = [];
        let node = el.nextSibling;
        while (node && details.length < 3) {
            if (node.type === "tag" && node.name === "h4") break;
            if (node.type === "text") {
                const text = node.data?.trim();
                if (text) details.push(text);
            } else if (node.type === "tag") {
                const text = $(node).text().trim();
                if (text) details.push(text);
            }
            node = node.nextSibling;
        }

        const [timeText, locationText, descriptionText] = details;
        const time_start = parseTimeTo24h(
            timeText ? timeText.split("-")[0].trim() : null
        );

        events.push(
            normaliseEvent({
                title,
                one_liner: null,
                description: descriptionText || null,
                image_url: null,
                location: locationText || null,
                booking_url: absoluteUrl(baseUrl, href),
                date_start,
                time_start,
                source: "hwunion",
                source_event_id: absoluteUrl(baseUrl, href)
            })
        );
    });

    return events;
}

async function scrapeHwUnion() {
    const now = new Date();
    const startYear = now.getFullYear();
    const startMonth = now.getMonth() + 1;
    const monthsToCrawl = [0, 1, 2].map(offset => {
        const date = new Date(startYear, startMonth - 1 + offset, 1);
        return { year: date.getFullYear(), month: date.getMonth() + 1 };
    });

    const events = [];
    for (const { year, month } of monthsToCrawl) {
        const url = `https://www.hwunion.com/ents/eventlist/?month=${month}&year=${year}`;
        const res = await axios.get(url, {
            headers: { "User-Agent": USER_AGENT }
        });
        const monthEvents = extractHwEvents(res.data, year, url);
        events.push(...monthEvents);
    }

    return events;
}

export async function scrapeUniPages(mode = "discovery", links = []) {
    console.log("Crawling university pages");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: USER_AGENT });

    const eusaExisting = extractExistingLinks(links, "eusa");
    const napierExisting = extractExistingLinks(links, "napier");

    const events = [];

    try {
        events.push(...(await scrapeEusa(page, mode === "refresh" ? eusaExisting : null)));
        events.push(
            ...(await scrapeNativeListing(
                page,
                "https://edinburghnapier.native.fm/",
                "napier",
                mode === "refresh" ? napierExisting : null,
                "Load More"
            ))
        );
        // events.push(...(await scrapeHwUnion()));
    } catch (error) {
        console.log(events);
        console.warn(error);
    } finally {
        await browser.close();
    }

    const deduped = new Map();
    for (const event of events) {
        const key = event?.source_event_id || event?.booking_url || event?.title;
        if (!key) continue;
        if (!deduped.has(key)) deduped.set(key, event);
    }

    return Array.from(deduped.values());
}