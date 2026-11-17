// Ephemeral stop signal across screens/tabs. No provider data or capabilities are broadcast.
const eventName = "videoalbum:stop-provider";
export function stopProviderWork() {
  globalThis.dispatchEvent(new Event(eventName));
  const channel = new BroadcastChannel(eventName);
  channel.postMessage("stop");
  channel.close();
}
export function onProviderStop(stop: () => void) {
  const channel = new BroadcastChannel(eventName);
  channel.onmessage = () => stop();
  globalThis.addEventListener(eventName, stop);
  return () => {
    channel.close();
    globalThis.removeEventListener(eventName, stop);
  };
}
