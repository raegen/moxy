import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { App } from '../panel-shared/App';
import { TabContext } from '../panel-shared/TabContext';
import '../panel-shared/panel.css';

// Side-panel host. Tracks the active tab via chrome.tabs.* and feeds it to the
// shared App via TabContext. The DevTools panel (v1.1b) provides a different
// host that reads chrome.devtools.inspectedWindow.tabId instead.
function SidePanelHost() {
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => {
        if (!cancelled && tab?.id) setTabId(tab.id);
      })
      .catch(() => {});

    const onActivated = ({ tabId: newId }: chrome.tabs.TabActiveInfo) => {
      setTabId(newId);
    };
    chrome.tabs.onActivated.addListener(onActivated);

    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  return (
    <TabContext.Provider value={tabId}>
      <App />
    </TabContext.Provider>
  );
}

const root = document.getElementById('root');
if (root) render(<SidePanelHost />, root);
