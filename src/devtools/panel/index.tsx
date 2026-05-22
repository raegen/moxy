import { render } from 'preact';
import { DevToolsPanelHost } from './host';
import '../../panel-shared/panel.css';

// DevTools host. `chrome.devtools.inspectedWindow.tabId` is a fixed integer
// scoped to this DevTools session — there's no equivalent of the side panel's
// chrome.tabs.onActivated. The shared App reads it via TabContext just like
// the side panel does. Lives in index.tsx so the side-effect runs at module
// load; host.tsx exports the component for testing.
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

const root = document.getElementById('root');
if (root) render(<DevToolsPanelHost tabId={inspectedTabId} />, root);
