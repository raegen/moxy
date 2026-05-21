import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
    sendMessage: vi.fn().mockResolvedValue(undefined),
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
