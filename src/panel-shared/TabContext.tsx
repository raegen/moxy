import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

// The "current tab id" the panel is operating on. Hosts provide it:
//   - Side panel: tracks active tab via chrome.tabs.query + chrome.tabs.onActivated.
//   - DevTools panel (v1.1b): chrome.devtools.inspectedWindow.tabId, fixed for the
//     DevTools session.
// Components inside panel-shared consume this via useTabId() and never call
// chrome.tabs.* directly — that keeps them portable across both hosts.
export const TabContext = createContext<number | null>(null);

export function useTabId(): number | null {
  return useContext(TabContext);
}
