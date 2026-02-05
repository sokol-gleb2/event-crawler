// src/scrapers/eventbrite.js
import { chromium } from "playwright";
import { normaliseEvent } from "../normalise.js";
import { parse } from 'json2csv';
import fs from 'node:fs';

export async function scrapeEventbrite(mode, links) {
    console.log("Crawling eventbrite");
    
    const normalisedMode = mode === "refresh" ? "refresh" : "discovery";
    const existingLinks = new Set(
        Array.isArray(links)
            ? links
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
            : []
    );

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const events = [];
    const linksCrawled = [];

    const BASE_URL =
        "https://www.eventbrite.co.uk/d/united-kingdom--edinburgh/students/";

    const crawlEvent = async link => {
        try {
            await page.goto(link, { waitUntil: "networkidle" });

            const data = await page.evaluate(() => {
                const nodes = Array.from(
                    document.querySelectorAll('script[type="application/ld+json"]')
                );

                for (const n of nodes) {
                    try {
                        const obj = JSON.parse(n.innerText);
                        if (obj && obj.description) return obj;
                    } catch {}
                }
                return null;
            });

            let one_liner;
            const isFree = await page.$(".CondensedConversionBar-module__priceTag___3AnIu");
            if (isFree) one_liner = "Free";
            else {
                const priceEl = await page.$(
                    ".LiveEventPanelInfo_headline__KqgCO > span"
                );

                if (priceEl) {
                    one_liner = await priceEl.evaluate(el => {
                        for (const node of el.childNodes) {
                            if (node.nodeType === Node.TEXT_NODE) {
                                const text = node.textContent.trim();
                                if (text) return text;
                            }
                        }
                        return "";
                    });
                } else {
                    one_liner = "Donation";
                }
            }

            events.push(
                normaliseEvent({
                    title: data?.name,
                    one_liner,
                    description: data?.description,
                    image_url: data?.image,
                    location: data?.location?.name + ", " + data?.location?.address?.streetAddress,
                    booking_url: link,
                    date_start: data?.startDate?.split("T")[0],
                    time_start: data?.startDate?.split("T")[1],
                    source: "eventbrite",
                    source_event_id: data?.["@id"] ?? link
                })
            );
        } catch (err) {
            console.warn("Eventbrite event skipped", err.message);
        }
    };

    if (normalisedMode === "refresh") {
        for (const link of existingLinks) {
            await crawlEvent(link);
        }
    } else {
        for (let pageNum = 1; pageNum <= 5; pageNum++) {
            const url =
                pageNum === 1
                    ? BASE_URL
                    : `${BASE_URL}?page=${pageNum}`;

            await page.goto(url, { waitUntil: "networkidle" });

            const eventLinks = [
                ...new Set(
                    await page.$$eval(
                        "ul.SearchResultPanelContentEventCardList-module__eventList___2wk-D > li a",
                        links => links.map(link => link.href)
                    )
                )
            ];

            const linksToCrawl = existingLinks.size
                ? eventLinks.filter(link => !existingLinks.has(link))
                : eventLinks;

            for (const link of linksToCrawl) {
                if (linksCrawled.includes(link)) continue;
                linksCrawled.push(link);
                await crawlEvent(link);
            }
        }

        const csv = parse(events);
        const filename = `edinburgh-eventbrite-events.csv`;
        fs.writeFileSync(filename, csv);
    }

    await browser.close();
    return events;
}
