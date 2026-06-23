import { ApifyClient } from "apify-client";

const ACTOR_ID = "shu8hvrXbJbY3Eb9W";
const APIFY_TOKEN = process.env.APIFY_KEY;

const DEFAULT_START_URLS = [
    "https://www.instagram.com/explore/tags/edinburghevents/",
    "https://www.instagram.com/explore/tags/edinburghnightlife/",
    "https://www.instagram.com/explore/tags/edinburghfestival/",
    "https://www.instagram.com/explore/tags/edinburghgig/",
    "https://www.instagram.com/explore/tags/edinburghrave/",
];

const EVENT_KEYWORDS = [
    "event",
    "events",
    "gig",
    "gigs",
    "reel",
    "party",
    "club",
    "night",
    "rave",
    "live",
    "show",
    "shows",
    "lineup",
    "tickets",
    "ticket link",
    "doors",
    "opening",
    "launch",
    "festival",
    "fringe",
    "comedy",
    "workshop",
    "exhibition",
    "market",
    "dj",
    "band",
    "performance",
    "tonight",
    "this friday",
    "this saturday",
    "this sunday",
];

const EDINBURGH_KEYWORDS = [
    "edinburgh",
    "edi",
    "eh1",
    "eh2",
    "eh3",
    "eh6",
    "eh7",
    "eh8",
    "eh9",
    "eh11",
    "eh12",
    "eh15",
    "leith",
    "new town",
    "old town",
    "bruntsfield",
    "stockbridge",
    "haymarket",
    "grassmarket",
    "cowgate",
    "morningside",
];

const POST_TYPES = new Set([
    "image",
    "video",
    "sidecar",
    "post",
    "reel",
    "clips",
]);

function lower(value) {
    return typeof value === "string" ? value.toLowerCase() : "";
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return null;
}

function asDate(value) {
    if (!value) return null;

    if (typeof value === "number") {
        const millis = value > 9999999999 ? value : value * 1000;
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function normaliseItem(rawItem) {
    const caption = firstString(
        rawItem?.caption,
        rawItem?.latestComments?.[0]?.text,
        rawItem?.edge_media_to_caption?.edges?.[0]?.node?.text,
    );

    const url = firstString(
        rawItem?.url,
        rawItem?.postUrl,
        rawItem?.shortCodeUrl,
        rawItem?.shortcodeUrl,
        rawItem?.inputUrl,
    );

    const ownerFullName = firstString(
        rawItem?.ownerFullName,
        rawItem?.owner?.fullName,
        rawItem?.owner?.username,
        rawItem?.username,
    );

    const imageUrl = firstString(
        rawItem?.displayUrl,
        rawItem?.thumbnailUrl,
        rawItem?.thumbnailSrc,
        rawItem?.imageUrl,
        rawItem?.images?.[0],
        rawItem?.images?.[0]?.url,
        rawItem?.images?.[0]?.displayUrl,
        rawItem?.childPosts?.[0]?.displayUrl,
        rawItem?.childPosts?.[0]?.imageUrl,
        rawItem?.childPosts?.[0]?.images?.[0],
        rawItem?.childPosts?.[0]?.images?.[0]?.url,
    );

    const type = lower(
        rawItem?.type ??
        rawItem?.productType ??
        rawItem?.__typename ??
        rawItem?.mediaType
    );

    const timestamp = asDate(
        rawItem?.timestamp ??
        rawItem?.takenAtTimestamp ??
        rawItem?.taken_at_timestamp ??
        rawItem?.createdAt
    );

    return {
        caption,
        url,
        ownerFullName,
        imageUrl,
        timestamp,
        type,
    };
}

function isPostOrReel(item) {
    if (!item.type) return true;
    return [...POST_TYPES].some((value) => item.type.includes(value));
}

function looksLikeEdinburghEventPost(item) {
    const haystack = lower(`${item.caption ?? ""} ${item.ownerFullName ?? ""}`);

    if (!haystack) return false;

    const hasEdinburghSignal = EDINBURGH_KEYWORDS.some((keyword) => haystack.includes(keyword));
    const hasEventSignal = EVENT_KEYWORDS.some((keyword) => haystack.includes(keyword));

    return hasEdinburghSignal && hasEventSignal;
}

function sortNewestFirst(items) {
    return [...items].sort((left, right) => {
        const leftTime = left.timestamp?.getTime() ?? 0;
        const rightTime = right.timestamp?.getTime() ?? 0;
        return rightTime - leftTime;
    });
}

function dedupeByUrl(items) {
    const seen = new Set();

    return items.filter((item) => {
        if (!item.url || seen.has(item.url)) {
            return false;
        }

        seen.add(item.url);
        return true;
    });
}

function toExistingUrlSet(existingUrls) {
    return new Set(
        (Array.isArray(existingUrls) ? existingUrls : [])
            .map((item) => {
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

export async function scrapeEdinburghInstagramPosts({
    startUrls = DEFAULT_START_URLS,
    limit = 200,
    existingUrls = [],
} = {}) {
    if (!APIFY_TOKEN) {
        throw new Error("Missing APIFY_KEY in environment.");
    }

    const client = new ApifyClient({ token: APIFY_TOKEN });

    const actorInput = {
        directUrls: startUrls,
        resultsType: "posts",
        resultsLimit: limit,
        addParentData: false,
    };

    const run = await client.actor(ACTOR_ID).call(actorInput);
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
    const existingUrlSet = toExistingUrlSet(existingUrls);

    return dedupeByUrl(
        sortNewestFirst(
            items
                .map(normaliseItem)
                .filter((item) => item.caption && item.url && item.ownerFullName)
                .filter(isPostOrReel)
                .filter((item) => !existingUrlSet.has(item.url))
        )
    ).map((item) => ({
        caption: item.caption,
        url: item.url,
        ownerFullName: item.ownerFullName,
        image_url: item.imageUrl,
        timestamp: item.timestamp ? item.timestamp.toISOString() : null,
    }));
}

export { DEFAULT_START_URLS };