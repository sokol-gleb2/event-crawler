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
        
        if (source === "uoe") {
            const scripts = Array.from(
                document.querySelectorAll('script[type="application/ld+json"]')
            );
            const parsed = [];
            for (const script of scripts) {
                try {
                    const json = JSON.parse(script.textContent || "");
                    parsed.push(json);
                } catch {}
            }

            parsed[0].filter(j => j?.["@type"]==="Event").forEach(event => {
                events.push(
                    normaliseEvent({
                        title: event?.name,
                        one_liner: "University of Edinburgh",
                        description: event?.description,
                        image_url: event?.image[0],
                        location: event?.location?.name + ", " + event?.location?.streetAddress + ", " + event?.location?.postalCode,
                        booking_url: event?.url,
                        date_start: event?.startDate?.split("T")[0],
                        time_start: event?.startDate?.split("T")[1],
                        source: "uoe",
                        source_event_id: event?.url,
                    })
                );
            })
        } else if (source === "eusa") {
            events.push(
                normaliseEvent({
                    title: document.querySelector('h1')?.content || null,
                    one_liner: event?.cost,
                    description: document.querySelector("article.g-mb-15 div[class='g-font-size-16 g-line-height-1_8 g-my-30']")?.innerText || null,
                    image_url: document.querySelector('article img.img-fluid')?.src || null,
                    location: event?.location?.name + ", " + event?.location?.streetAddress + ", " + event?.location?.postalCode,
                    booking_url: fallbackUrl,
                    date_start: event?.startDate?.split("T")[0],
                    time_start: event?.startDate?.split("T")[1],
                    source: "uoe",
                    source_event_id: event?.url,
                })
            );
            // const og = {
            //     title: document.querySelector('h1')?.content || null,
            //     description:
            //         document.querySelector("article.g-mb-15 div[class='g-font-size-16 g-line-height-1_8 g-my-30']")?.innerText || null,
            //     image: document.querySelector('article img.img-fluid')?.src || null,
            //     url: document.querySelector('meta[property="og:url"]')?.content || null
            // };
        }

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

async function scrapeUoe(page) {
    const listUrl = "https://www.ed.ac.uk/events/latest";
    await page.goto(listUrl, { waitUntil: "networkidle" });
    const events = await extractEventsFromPage(page, "uoe", listUrl);
    return events;
}

async function scrapeNativeListing(page, baseUrl, source, existingLinks, buttonText) {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await clickLoadMore(
        page,
        `button:has-text("${buttonText}"), a:has-text("${buttonText}")`
    );

    const links = await collectLinks(page, ["native.fm"], ["/event/"]);
    const linksToCrawl =
        existingLinks && existingLinks.size
            ? links.filter(link => !existingLinks.has(link))
            : links;

    const events = [];
    for (const link of linksToCrawl) {
        await page.goto(link, { waitUntil: "networkidle" });
        const detailEvents = await extractEventsFromPage(page, source, link);
        if (detailEvents.length) {
            events.push(...detailEvents);
        }
    }

    return events;
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
        const detailEvents = await extractEventsFromPage(page, "eusa", link);
        if (detailEvents.length) {
            events.push(...detailEvents);
        }
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

    const uoeExisting = extractExistingLinks(links, "uoe");
    const eusaExisting = extractExistingLinks(links, "eusa");
    const napierExisting = extractExistingLinks(links, "napier");

    const events = [];

    try {
        if (mode === "refresh" && uoeExisting.size) {
            for (const link of uoeExisting) {
                await page.goto(link, { waitUntil: "networkidle" });
                const detailEvents = await extractEventsFromPage(page, "uoe", link);
                events.push(...detailEvents);
            }
        } else {
            events.push(...(await scrapeUoe(page)));
        }

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
        events.push(...(await scrapeHwUnion()));
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
