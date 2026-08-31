const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const contexts = browser.contexts();
    
    for (const ctx of contexts) {
        for (const page of ctx.pages()) {
            const title = await page.title();
            let filename = "";
            if (title.includes("DeepSeek")) filename = "r2-ds.txt";
            else if (title.includes("ChatGPT") || title.includes("chatgpt") || title.includes("Architecture Merge")) filename = "r2-cgpt.txt";
            else if (title.includes("Gemini") || title.includes("Unified Plan")) filename = "r2-gemini.txt";
            else continue;
            
            console.error(`Extracting: ${title} -> ${filename}`);
            
            try {
                const text = await page.evaluate(() => {
                    const selectors = [
                        '[data-message-author-role="assistant"]',
                        '.ds-markdown',
                        '.markdown-body',
                        '.agent-turn',
                        'div[class*="response"]',
                        'div[class*="message"]'
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
                
                fs.writeFileSync(`C:/cr mod/webq-gauntlet/engine/${filename}`, text, "utf8");
                console.error(`Saved ${filename} (${text.length} chars)`);
            } catch (e) {
                console.error(`Error: ${e.message}`);
            }
        }
    }
    browser.disconnect();
})();
