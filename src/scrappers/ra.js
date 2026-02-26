import { ApifyClient } from 'apify-client';
import { parse } from 'json2csv';
import fs from 'node:fs';
import { normaliseEvent } from "../normalise.js";

const API_KEY = process.env.APIFY_KEY;

// Initialise the Apify client with your API token
const client = new ApifyClient({
    token: API_KEY,
});

export async function scrapeRA(mode = "discovery", links = [], resultsToCrawl = 10) {
    console.log("Crawling RA");
    const events = [];
    
    try {
        let run;

        const normalisedLinks = Array.isArray(links)
            ? links
                .map((item) => {
                    if (typeof item === "string") return item;
                    if (!item || typeof item !== "object") return null;
                    return item.booking_url ?? item.url ?? item.link ?? item.source_event_id ?? null;
                })
                .filter((link) => typeof link === "string" && link.trim().length > 0)
                .map((url) => url.trim())
                .map((url) => (url.startsWith("/") ? `https://ra.co${url}` : url))
                .map((url) => ({ url }))
            : [];

        const existingLinks = new Set(links);
        console.log(existingLinks.has('https://ra.co/events/2363219'));
        console.log(existingLinks.has('https://ra.co/events/2362813'));
        
        
        

        if (mode === "discovery") {
            // Run the Resident Advisor scraper actor
            run = await client.actor('chalkandcheese/ra-events-scraper').call({
                "startUrls": [
                    { "url": "https://ra.co/events/uk/edinburgh" },
                ],
                "maxItems": resultsToCrawl,
                // "downloadDelay": 1500,
                "proxyConfiguration": {
                    "useApifyProxy": true
                }
            });
        } else {
            const refreshStartUrls = normalisedLinks.length
                ? normalisedLinks
                : [{ url: "https://ra.co/events/uk/edinburgh" }];

            run = await client.actor('chalkandcheese/ra-events-scraper').call({
                "startUrls": refreshStartUrls,
                "maxItems": resultsToCrawl,
                // "downloadDelay": 1500,
                "proxyConfiguration": {
                    "useApifyProxy": true
                }
            });
        }

        // Fetch results from the dataset
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        
        console.log(`Found ${items.length} events in Edinburgh:`);

        items.forEach(data => {
            try {
                const bookingUrl = data?.contentUrl
                    ? `https://ra.co${String(data.contentUrl).replace(/^\/+/, "")}`
                    : null;

                if (mode === "discovery" && bookingUrl && existingLinks.has(bookingUrl)) {
                    return;
                }

                events.push(
                    normaliseEvent({
                        title: data?.title,
                        one_liner: data?.cost,
                        description: data?.content,
                        image_url: data?.images.filter(i => i.type==="FLYERFRONT")[0].filename,
                        location: data?.venue?.name + ", " + data?.venue?.address,
                        booking_url: bookingUrl,
                        date_start: data?.date?.split("T")[0],
                        time_start: data?.startTime?.split("T")[1],
                        source: "ra",
                        source_event_id: data?.id ?? bookingUrl,
                        attending: data?.interestedCount,
                    })
                );
            } catch (error) {
                console.error(error);
            }
        });

        if (events.length > 0) {
            const csv = parse(events);
            const filename = `edinburgh-events.csv`;
            fs.writeFileSync(filename, csv);
        }

        return events;
        
    } catch (error) {
        console.error('Error fetching events:', error);
        throw error;
    }
}