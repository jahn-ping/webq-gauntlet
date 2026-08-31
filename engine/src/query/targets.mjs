export const TARGETS = {
  deepseek: {
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    inputSels: ['textarea#chat-input', 'textarea[placeholder*="Message"]'],
    answerSels: ['.ds-markdown', '[class*="markdown"]'],
    stopSels: ['div[class*="stop"]', 'button[aria-label*="Stop"]'],
    welcomeSels: [
      'button:has-text("Continue")',
      'button:has-text("Get started")',
      'button:has-text("Start chatting")',
    ],
    loggedOutSels: ['button:has-text("Log in")', 'button:has-text("Sign in")', 'a:has-text("Log in")'],
    continueSels: [
      'button:has-text("Continue generating")',
      'div[role="button"]:has-text("Continue generating")',
    ],
    rateLimitSels: [
      'text=/too many messages/i',
      'text=/rate limit/i',
      'text=/try again later/i',
      'text=/server is busy/i',
    ],
    conversationLimitSels: [
      'text=/reached the limit/i',
      'text=/maximum conversation length/i',
    ],
  },

  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    inputSels: ['#prompt-textarea', 'textarea[data-id="root"]'],
    answerSels: ['[data-message-author-role="assistant"]'],
    stopSels: ['button[data-testid="stop-button"]', 'button[aria-label="Stop generating"]'],
    welcomeSels: [],
    loggedOutSels: ['a[href*="auth/login"]', 'button:has-text("Log in")', 'button:has-text("Sign up")'],
    continueSels: ['button:has-text("Continue generating")', 'button:has-text("Continue")'],
    rateLimitSels: [
      'text=/you.ve reached/i',
      'text=/you have reached/i',
      'text=/rate limit/i',
      'text=/try again later/i',
      'text=/message limit/i',
    ],
    conversationLimitSels: [
      'text=/maximum length/i',
      'text=/this conversation is too long/i',
    ],
  },

  claude: {
    label: 'Claude',
    url: 'https://claude.ai/new',
    inputSels: ['div[contenteditable="true"]', 'textarea'],
    answerSels: ['div[class*="font-claude-message"]', '[data-testid="message-content"]'],
    stopSels: ['button[aria-label="Stop response"]'],
    welcomeSels: ['button:has-text("Accept")', 'button:has-text("Continue")'],
    loggedOutSels: ['a[href*="/auth"]', 'button:has-text("Log in")', 'button:has-text("Sign in")'],
    continueSels: ['button:has-text("Continue generating")', 'button:has-text("Continue")'],
    rateLimitSels: [
      'text=/you.ve reached your usage limit/i',
      'text=/reached the limit for this/i',
      'text=/message limit reached/i',
      'text=/try again later/i',
    ],
    conversationLimitSels: [
      'text=/this conversation is long/i',
      'text=/start a new conversation/i',
    ],
  },

  gemini: {
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    inputSels: ['div[contenteditable="true"][role="textbox"]', 'rich-textarea'],
    answerSels: ['message-content', '.model-response-text'],
    stopSels: ['button[aria-label="Stop response"]'],
    welcomeSels: ['button:has-text("Accept all")', 'button:has-text("Accept")', 'button:has-text("Continue")'],
    loggedOutSels: ['button:has-text("Sign in")', 'a[href*="ServiceLogin"]'],
    continueSels: ['button:has-text("Continue generating")', 'button:has-text("Continue")'],
    rateLimitSels: [
      'text=/you.ve reached your limit/i',
      'text=/rate limit/i',
      'text=/try again later/i',
      'text=/high demand/i',
    ],
    conversationLimitSels: [
      'text=/conversation is too long/i',
      'text=/start a new chat/i',
    ],
  },
};
