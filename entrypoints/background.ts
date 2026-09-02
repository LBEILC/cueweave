export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    const settings = await browser.storage.local.get(['cueweave.enabled']);
    if (settings['cueweave.enabled'] === undefined) {
      await browser.storage.local.set({ 'cueweave.enabled': true });
    }
  });
});
