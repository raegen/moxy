import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

// The "current tab id" the DevTools panel is operating on. The host provides
// chrome.devtools.inspectedWindow.tabId — fixed for the DevTools session.
// (v1.3 removed the side-panel host that used to track active tab via
// chrome.tabs.onActivated. The side panel is a per-tab roster now and has
// no single "current tab" concept.)
export const TabContext = createContext<number | null>(null);

export function useTabId(): number | null {
  return useContext(TabContext);
}
