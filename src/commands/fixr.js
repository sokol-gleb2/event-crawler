// Open fixr.co/search
// Copy and paste this code
// Put downloaded file in /docs

async function getIndividualEvent(id) {

    const url = `https://api.fixr.co/api/v2/app/event/${id}`

    const res = await fetch(
        url,
        {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "Accept-Language": "en-GB",
                "User-Agent": "Mozilla/5.0"
            }
        }
    );

    const data = await res.json();
    return data;
}

function normaliseEvent(partial) {
    return {
        title: partial.title ?? null,
        one_liner: partial.one_liner ?? null,
        image_url: partial.image_url ?? null,
        location: partial.location ?? null,
        booking_url: partial.booking_url ?? null,
        description: partial.description ?? null,
        date_start: partial.date_start ?? null,
        time_start: partial.time_start ?? null,
        attending: partial.attending ?? null,
        source: partial.source,
        source_event_id: partial.source_event_id
    };
}

function splitIsoDateTime(value) {
    if (!value || typeof value !== "string") return { date_start: null, time_start: null };
    const [datePart, timePartRaw] = value.split("T");
    if (!timePartRaw) return { date_start: datePart || null, time_start: null };
    const timePart = timePartRaw.replace("Z", "");
    return { date_start: datePart || null, time_start: timePart || null };
}


(async () => {
    const params = new URLSearchParams({
        lat: 55.953252,
        lon: -3.188267,
        limit: 200,
        offset: 0,
        ordering: "opens_at_decay",
        radius: 25.00000
    });
    
    const res = await fetch(
        `https://api.fixr.co/search/events?${params.toString()}`,
        {
            method: "GET",
            headers: {
                "Accept": "application/json; version=3.0",
                "Accept-Language": "en-GB",
                "User-Agent": "Mozilla/5.0"
            }
        }
    );
    
    const json = await res.json();
    const events = [];
    
    for (const event of json.results) {
        const description = await getIndividualEvent(`${event.id}`);
        const { date_start, time_start } = splitIsoDateTime(event?.opens_at);
        events.push(normaliseEvent({
            title: event.name,
            one_liner: `From £${event.cheapest_ticket?.amount}`,
            image_url: event.image_url,
            location: `${event.venue?.name}, ${event.venue?.city}`,
            booking_url: `https://fixr.co/event/${event.routing_part}`,
            description: description.description,
            date_start,
            time_start,
            source: 'fixr',
            source_event_id: event.id
        }))
    }
    
    // convert object → JSON string
    const eventJson = JSON.stringify(events, null, 2);
    
    // create file blob
    const blob = new Blob([eventJson], { type: "application/json" });
    
    // create temporary download link
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = "fixrData.json";
    
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
})();