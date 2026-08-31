const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const contexts = browser.contexts();
    
    for (const ctx of contexts) {
        for (const page of ctx.pages()) {
            const title = await page.title();
            if (!title.includes("DeepSeek")) continue;
            
            console.error(`Extracting: ${title}`);
            
            try {
                const text = await page.evaluate(() => {
                    const selectors = [
                        '.ds-markdown',
                        '[data-message-author-role="assistant"]',
                        '.markdown-body'
                    ];
                    
                    for (const sel of selectors) {
                        const els = document.querySelectorAll(sel);
                        if (els.length > 0) {
                            const texts = Array.from(els).map(e => e.innerText).filter(t => t.length > 200);
                            if (texts.length > 0) return texts[texts.length - 1];
                        }
                    }
                    return document.body.innerText;
                });
                
                fs.writeFileSync("C:/cr mod/webq-gauntlet/engine/final-response.txt", text, "utf8");
                console.error(`Saved final-response.txt (${text.length} chars)`);
            } catch (e) {
                console.error(`Error: ${e.message}`);
            }
        }
    }
    browser.disconnect();
})();
