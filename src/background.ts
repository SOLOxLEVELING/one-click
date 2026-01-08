// Background Service Worker
console.log('Context-Snap: Background service started');

const triggerExtraction = (tab: chrome.tabs.Tab) => {
  if (!tab.id) return;
  
  chrome.tabs.sendMessage(tab.id, { action: 'snap' }).catch((err: unknown) => {
    console.warn('Could not send message to tab:', err);
  });
};

// Handle Icon Click
chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
  triggerExtraction(tab);
});

// Handle Keyboard Shortcut
chrome.commands.onCommand.addListener((command: string, tab?: chrome.tabs.Tab) => {
  if (command === 'snap_context' && tab) {
    triggerExtraction(tab);
  }
});
