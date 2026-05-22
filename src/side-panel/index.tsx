import { render } from 'preact';
import { SidePanelApp } from './App';
import '../panel-shared/panel.css';

// Side panel host (v1.3). No TabContext — the side panel doesn't have a single
// "current tab"; it shows a roster of all tabs that are currently mocking.

const root = document.getElementById('root');
if (root) render(<SidePanelApp />, root);
