const http = require("http");
const WebSocket = require("ws");

const tabId = process.argv[2];
const wsUrl = `ws://localhost:9222/devtools/page/${tabId}`;

const ws = new WebSocket(wsUrl);
ws.on("open", () => {
    ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
            expression: `
                const msgs = document.querySelectorAll('.ds-markdown, .markdown-body, [class*=message], [class*=assistant], .ds-block');
                if (msgs.length > 0) {
                    Array.from(msgs).map(m => m.textContent.trim()).filter(t => t.length > 50).join('\\n---SEPARATOR---\\n');
                } else {
                    const main = document.querySelector('main, [class*=chat], [class*=conversation]');
                    main ? main.innerText : document.body.innerText;
                }
            `,
            returnByValue: true
        }
    }));
});
ws.on("message", (data) => {
    const resp = JSON.parse(data);
    if (resp.id === 1) {
        console.log(resp.result?.result?.value || "NO VALUE");
        ws.close();
    }
});
ws.on("error", (e) => { console.error("WS Error:", e.message); process.exit(1); });
