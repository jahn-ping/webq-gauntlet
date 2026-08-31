const { chromium } = require("playwright");

(async () => {
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const contexts = browser.contexts();
    
    for (const ctx of contexts) {
        for (const page of ctx.pages()) {
            const title = await page.title();
            if (!title.includes("Design ToneReset")) continue;
            
            console.error(`Found ChatGPT tab: ${title}`);
            
            try {
                const text = await page.evaluate(() => {
                    const selectors = [
                        '[data-message-author-role="assistant"]',
                        '.markdown-body',
                        '.agent-turn',
                        'div[class*="response"]',
                        'div[class*="message"]'
                    ];
                    
                    for (const sel of selectors) {
                        const els = document.querySelectorAll(sel);
                        if (els.length > 0) {
                            // Get ALL assistant responses and join them
                            const texts = Array.from(els).map(e => e.innerText).filter(t => t.length > 200);
                            if (texts.length > 0) return texts.join('\n\n---SEPARATOR---\n\n');
                        }
                    }
                    
                    return document.body.innerText;
                });
                
                require("fs").writeFileSync(
                    `C:/cr mod/webq-gauntlet/engine/cgpt-response.txt`, 
                    text, 
                    "utf8"
                );
                console.error(`Saved cgpt-response.txt (${text.length} chars)`);
            } catch (e) {
                console.error(`Error: ${e.message}`);
            }
        }
    }
})();
