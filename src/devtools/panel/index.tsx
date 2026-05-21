import { render } from 'preact';
import { App } from '../../panel-shared/App';
import { TabContext } from '../../panel-shared/TabContext';
import '../../panel-shared/panel.css';

// DevTools host. `chrome.devtools.inspectedWindow.tabId` is a fixed integer
// scoped to this DevTools session — there's no equivalent of the side panel's
// chrome.tabs.onActivated. The shared App reads it via TabContext just like
// the side panel does.
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

function DevToolsPanelHost() {
  return (
    <TabContext.Provider value={inspectedTabId}>
      <App />
    </TabContext.Provider>
  );
}

const root = document.getElementById('root');
if (root) render(<DevToolsPanelHost />, root);
