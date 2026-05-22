import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

afterEach(() => {
  cleanup();
  // clearAllMocks preserves implementations (mockResolvedValue, etc.) while
  // resetting call history. restoreAllMocks() would wipe the chrome.* stubs
  // back to bare vi.fn() returning undefined, breaking async-gated UI tests.
  vi.clearAllMocks();
});

// Minimal chrome.* stub. Tests can override individual methods via vi.spyOn
// or by writing to the mock objects. Anything not stubbed will throw, which
// is intentional — surfaces unmocked API calls early.
const chromeStub = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({ ok: true, data: null }),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    getManifest: vi.fn().mockReturnValue({ content_scripts: [] }),
  },
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
    get: vi.fn().mockResolvedValue({ id: 42, url: 'https://example.com/', windowId: 1 }),
    update: vi.fn().mockResolvedValue(undefined),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
  windows: {
    update: vi.fn().mockResolvedValue(undefined),
  },
  permissions: {
    // Default to granted so existing tests render the App without gating.
    contains: vi.fn().mockResolvedValue(true),
    request: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    getAll: vi.fn().mockResolvedValue({ permissions: [], origins: ['<all_urls>'] }),
    onAdded: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  devtools: {
    inspectedWindow: { tabId: 42 },
    network: { onNavigated: { addListener: vi.fn(), removeListener: vi.fn() } },
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue([]),
    registerContentScripts: vi.fn().mockResolvedValue(undefined),
    getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
  },
  sidePanel: {
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
  },
  extension: {
    isAllowedIncognitoAccess: vi.fn().mockResolvedValue(false),
  },
};

vi.stubGlobal('chrome', chromeStub);
