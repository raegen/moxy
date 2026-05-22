import { App } from '../../panel-shared/App';
import { TabContext } from '../../panel-shared/TabContext';

// The DevTools panel UI, parameterized by the tab id the DevTools session is
// inspecting. Separated from index.tsx so tests can pass an explicit tabId
// without needing to mock chrome.devtools.inspectedWindow.
export function DevToolsPanelHost({ tabId }: { tabId: number }) {
  return (
    <TabContext.Provider value={tabId}>
      <App />
    </TabContext.Provider>
  );
}
