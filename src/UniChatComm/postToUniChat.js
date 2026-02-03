import fetch from "node-fetch";

export async function postEvents(events) {
    const res = await fetch(
        "https://www.uni-chat.com/api/events/postEventsFromCrawler",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.CRAWLER_KEY}`
            },
            body: JSON.stringify({ events })
        }
    );

    if (!res.ok) {
        throw new Error("Failed to post events");
    }
}