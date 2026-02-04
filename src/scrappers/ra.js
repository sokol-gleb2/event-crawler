import { ApifyClient } from 'apify-client';
import { parse } from 'json2csv';
import fs from 'node:fs';
import { normaliseEvent } from "../normalise.js";

const API_KEY = process.env.APIFY_KEY;

// Initialise the Apify client with your API token
const client = new ApifyClient({
    token: API_KEY,
});
const events = [];

export async function scrapeRA(mode = "discovery", links = [], resultsToCrawl = 10) {
    console.log("Crawling RA");
    
    try {
        let run;
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
            run = await client.actor('chalkandcheese/ra-events-scraper').call({
                "startUrls": [links.map(l => ({ url: l }))],
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
        // items.forEach((event, index) => {
        //     console.log(`\n${index + 1}. ${event.name || event.title}`);
        //     console.log(`   Date: ${event.date}`);
        //     console.log(`   Venue: ${event.venue}`);
        //     console.log(`   URL: ${event.url}`);
        // });

        const csv = parse(items);
        const filename = `edinburgh-events.csv`;
        fs.writeFileSync(filename, csv);


        items.forEach(data => {
            try {
                events.push(
                    normaliseEvent({
                        title: data?.title,
                        one_liner: data?.cost,
                        description: data?.content,
                        image_url: data?.images.filter(i => i.type==="FLYERFRONT")[0].filename,
                        location: data?.venue?.name + ", " + items?.venue?.address,
                        booking_url: `https://ra.co/${data?.contentUrl}`,
                        date_start: data?.date?.split("T")[0],
                        time_start: data?.startTime?.split("T")[1],
                        source: "ra",
                        source_event_id: data?.id ?? `https://ra.co/${items?.contentUrl}`,
                        attending: data?.interestedCount,
                    })
                );
            } catch (error) {
                
            }
        });

        return events;
        
    } catch (error) {
        console.error('Error fetching events:', error);
        throw error;
    }
}