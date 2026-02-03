export function normaliseEvent(partial) {
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