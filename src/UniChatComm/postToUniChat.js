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

    const text = await res.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        // non-JSON response
    }

    if (!res.ok) {
        const ip = data?.ip ?? null;
        if (ip) {
            console.error(`Post events blocked. Server saw IP: ${ip}`);
        }
        throw new Error(
            `Failed to post events: ${res.status} ${text}${
                ip ? ` (server IP: ${ip})` : ""
            }`
        );
    }

    if (data) {
        console.log("Post events response:");
        console.dir(data, { depth: null });
    } else {
        console.log("Post events response (non-JSON):", text);
    }

    return data ?? text;
}
