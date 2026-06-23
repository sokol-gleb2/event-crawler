import asyncio
from crawl4ai import *

async def main():
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(
            # url="https://www.skiddle.com/whats-on/events/Edinburgh/?radius=10&hidecancelled=1",
            url="https://www.reddit.com/r/LanaParrillaFans/comments/1ud6m2w/meet_ashley_barrett_bad_day_at_the_office/",
        )
        markdown = result.markdown

if __name__ == "__main__":
    asyncio.run(main())