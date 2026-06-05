import asyncio
from crawl4ai import *

async def main():
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(
            # url="https://www.skiddle.com/whats-on/events/Edinburgh/?radius=10&hidecancelled=1",
            url="https://ra.co/events/uk/edinburgh",
        )
        print(result.markdown)

if __name__ == "__main__":
    asyncio.run(main())