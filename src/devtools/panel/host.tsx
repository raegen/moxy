import { App } from './App';
import { TabContext } from './TabContext';
import { PermissionGate } from './PermissionGate';

// The DevTools panel UI, parameterized by the tab id the DevTools session is
// inspecting. The PermissionGate auto-requests host permission for the
// inspected origin on first mount; if granted, it renders the shared App.
// Separated from index.tsx so tests can pass an explicit tabId without
// needing to mock chrome.devtools.inspectedWindow.
export function DevToolsPanelHost({ tabId }: { tabId: number }) {
  return (
    <TabContext.Provider value={tabId}>
      <PermissionGate tabId={tabId}>
        <App />
      </PermissionGate>
    </TabContext.Provider>
  );
}
