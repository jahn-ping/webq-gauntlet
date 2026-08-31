const { chromium } = require("playwright");

(async () => {
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const contexts = browser.contexts();
    
    for (const ctx of contexts) {
        for (const page of ctx.pages()) {
            const title = await page.title();
            if (!title.includes("DeepSeek")) continue;
            
            console.error(`Found DeepSeek: ${title}`);
            
            // Check what the answer selectors actually find
            const result = await page.evaluate(() => {
                const checks = {};
                
                // Check each selector
                const selectors = [
                    'div.ds-markdown',
                    'div[class*="ds-markdown"]',
                    '[data-message-author-role="assistant"]',
                    '.markdown-body',
                    '.ds-block'
                ];
                
                for (const sel of selectors) {
                    const els = document.querySelectorAll(sel);
                    checks[sel] = {
                        count: els.length,
                        lastTextLen: els.length > 0 ? els[els.length - 1].innerText.length : 0,
                        lastTextPreview: els.length > 0 ? els[els.length - 1].innerText.slice(0, 100) : ''
                    };
                }
                
                // Also check stop button visibility
                const stopSelectors = [
                    '[aria-label*="stop" i]',
                    'button[title*="Stop" i]',
                    'div[class*="stop" i][role="button"]'
                ];
                checks._stopButtons = {};
                for (const sel of stopSelectors) {
                    const els = document.querySelectorAll(sel);
                    checks._stopButtons[sel] = {
                        count: els.length,
                        visible: els.length > 0 ? Array.from(els).some(e => e.offsetParent !== null) : false
                    };
                }
                
                // Check for any button with stop-like text
                const allButtons = document.querySelectorAll('button, [role="button"]');
                checks._allButtons = Array.from(allButtons).map(b => ({
                    text: b.innerText?.slice(0, 50),
                    ariaLabel: b.getAttribute('aria-label'),
                    className: b.className?.slice(0, 80),
                    visible: b.offsetParent !== null
                })).filter(b => b.visible && (b.text?.toLowerCase().includes('stop') || b.ariaLabel?.toLowerCase().includes('stop')));
                
                return checks;
            });
            
            console.log(JSON.stringify(result, null, 2));
        }
    }
    browser.disconnect();
})();
