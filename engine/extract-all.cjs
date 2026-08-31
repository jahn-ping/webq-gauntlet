const { chromium } = require("playwright");

(async () => {
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const contexts = browser.contexts();
    
    for (const ctx of contexts) {
        for (const page of ctx.pages()) {
            const title = await page.title();
            console.error(`Found tab: ${title}`);
            
            let filename = "";
            if (title.includes("DeepSeek")) filename = "ds-response.txt";
            else if (title.includes("ChatGPT") || title.includes("chatgpt")) filename = "cgpt-response.txt";
            else if (title.includes("Gemini")) filename = "gemini-response.txt";
            else continue;
            
            try {
                const text = await page.evaluate(() => {
                    // Try to find the last assistant response
                    const selectors = [
                        '.ds-markdown',
                        '[data-message-author-role="assistant"]',
                        '.markdown-body',
                        '.agent-turn',
                        'div[class*="response"]'
                    ];
                    
                    for (const sel of selectors) {
                        const els = document.querySelectorAll(sel);
                        if (els.length > 0) {
                            const last = els[els.length - 1];
                            const text = last.innerText;
                            if (text.length > 200) return text;
                        }
                    }
                    
                    // Fallback: get all body text
                    return document.body.innerText;
                });
                
                require("fs").writeFileSync(
                    `C:/cr mod/webq-gauntlet/engine/${filename}`, 
                    text, 
                    "utf8"
                );
                console.error(`Saved ${filename} (${text.length} chars)`);
            } catch (e) {
                console.error(`Error extracting ${title}: ${e.message}`);
            }
        }
    }
    
    // Don't close - keep browser open
    browser.disconnect();
})();
