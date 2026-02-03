import { ApifyClient } from 'apify-client';

const API_KEY = process.env.APIFY_KEY;

// Initialize the Apify client with your API token
const client = new ApifyClient({
    token: API_KEY,
});

export async function scrapeRA(resultsToCrawl = 10) {
    try {
        // Run the Resident Advisor scraper actor
        const run = await client.actor('chalkandcheese/ra-events-scraper').call({
            "startUrls": [
                { "url": "https://ra.co/events/uk/edinburgh" },
            ],
            "maxItems": resultsToCrawl,
            // "downloadDelay": 1500,
            "proxyConfiguration": {
                "useApifyProxy": true
            }
        });

        // Fetch results from the dataset
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        
        console.log(`Found ${items.length} events in Edinburgh:`);
        items.forEach((event, index) => {
            console.log(`\n${index + 1}. ${event.name || event.title}`);
            console.log(`   Date: ${event.date}`);
            console.log(`   Venue: ${event.venue}`);
            console.log(`   URL: ${event.url}`);
        });

        // const csv = parse(items);
        // // Save to file
        // const filename = `edinburgh-events.csv`;
        // fs.writeFileSync(filename, csv);
        
        return items;
        
    } catch (error) {
        console.error('Error fetching events:', error);
        throw error;
    }
}