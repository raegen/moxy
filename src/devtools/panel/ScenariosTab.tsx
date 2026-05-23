import { useState } from 'preact/hooks';
import type { Scenario, SwResponse } from '../../shared/types';
import { parseScenario, serializeScenario, ScenarioImportError } from '../../shared/scenario';
import { EditableField } from './EditableField';

type Props = {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  tabId: number;
  onChanged: () => void;
};

async function send<T = unknown>(msg: unknown): Promise<T | null> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as SwResponse;
    if (res?.ok) return (res.data ?? null) as T | null;
    return null;
  } catch {
    return null;
  }
}

function downloadFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'scenario'
  );
}

export function ScenariosTab({ scenarios, activeScenarioId, tabId, onChanged }: Props) {
  const [pasteValue, setPasteValue] = useState('');
  const [importStatus, setImportStatus] = useState<{
    kind: 'idle' | 'success' | 'error' | 'warnings';
    message?: string;
    warnings?: string[];
  }>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const importFromText = async (text: string) => {
    setBusy(true);
    setImportStatus({ kind: 'idle' });
    try {
      const { scenario, warnings } = parseScenario(text);
      const stored = await send<Scenario>({ kind: 'sw:save-scenario', scenario });
      if (!stored) throw new Error('failed to save scenario');
      await send({ kind: 'sw:load-scenario', scenarioId: stored.id, tabId });
      onChanged();
      setImportStatus(
        warnings.length > 0
          ? { kind: 'warnings', message: `imported "${stored.name}" with ${warnings.length} warning(s)`, warnings }
          : { kind: 'success', message: `imported "${stored.name}" and loaded into this tab` }
      );
      setPasteValue('');
    } catch (e) {
      const msg =
        e instanceof ScenarioImportError
          ? e.message
          : e instanceof Error
          ? e.message
          : String(e);
      setImportStatus({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  const importFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      void importFromText(text);
    };
    reader.onerror = () => {
      setImportStatus({ kind: 'error', message: `could not read file: ${reader.error?.message ?? 'unknown'}` });
    };
    reader.readAsText(file);
  };

  const onFilePicker = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) importFromFile(file);
    input.value = ''; // reset so re-picking the same file fires onchange again
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) importFromFile(file);
  };

  const exportScenario = (s: Scenario) => {
    const filename = `${sanitizeFilename(s.name)}.moxy.json`;
    downloadFile(filename, serializeScenario(s));
  };

  const loadScenario = async (id: string) => {
    await send({ kind: 'sw:load-scenario', scenarioId: id, tabId });
    onChanged();
  };

  const deleteScenario = async (id: string, name: string) => {
    if (!confirm(`Delete scenario "${name}"? This cannot be undone.`)) return;
    await send({ kind: 'sw:delete-scenario', scenarioId: id });
    onChanged();
  };

  const duplicateScenario = async (s: Scenario) => {
    // Strip id so save-scenario treats it as new (and runs uniqueNameFor).
    const copy: Scenario = {
      ...s,
      id: `${s.id}-copy-${Date.now().toString(36)}`,
      name: s.name,
      createdAt: Date.now(),
    };
    await send({ kind: 'sw:save-scenario', scenario: copy });
    onChanged();
  };

  const updateScenarioField = async (s: Scenario, patch: Partial<Pick<Scenario, 'name' | 'description'>>) => {
    const updated: Scenario = { ...s, ...patch };
    await send({ kind: 'sw:save-scenario', scenario: updated });
    onChanged();
  };

  // Drag-to-filesystem export. Chrome materializes the drop as a real file
  // when the `DownloadURL` DataTransfer type is set (`mime:filename:url`).
  // We also expose application/json + text/plain so dragging into an editor
  // or chat window pastes the raw scenario JSON.
  const onScenarioDragStart = (s: Scenario, e: DragEvent) => {
    if (!e.dataTransfer) return;
    const json = serializeScenario(s);
    const filename = `${sanitizeFilename(s.name)}.moxy.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    // Release the blob URL after the drag completes (or aborts).
    const cleanup = () => {
      URL.revokeObjectURL(blobUrl);
      (e.target as HTMLElement)?.removeEventListener('dragend', cleanup);
    };
    (e.target as HTMLElement)?.addEventListener('dragend', cleanup);

    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('DownloadURL', `application/json:${filename}:${blobUrl}`);
    e.dataTransfer.setData('application/json', json);
    e.dataTransfer.setData('text/plain', json);
  };

  return (
    <div class="scenarios-tab">
      <section class="scenarios-import">
        <h3 class="section-h">Import</h3>
        <div
          class={'drop-zone' + (dragging ? ' dragging' : '')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>
            Drop a <code>.moxy.json</code> here
          </p>
          <p class="muted">or</p>
          <label class="btn-sm" tabIndex={0}>
            choose a file
            <input type="file" accept=".json,application/json" onChange={onFilePicker} hidden />
          </label>
        </div>
        <details class="paste-details">
          <summary>or paste JSON</summary>
          <textarea
            rows={6}
            value={pasteValue}
            onInput={(e) => setPasteValue((e.target as HTMLTextAreaElement).value)}
            placeholder='{"moxyFormatVersion": 1, "name": "...", "rules": [...]}'
            spellcheck={false}
          />
          <button
            class="btn-primary"
            disabled={!pasteValue.trim() || busy}
            onClick={() => void importFromText(pasteValue)}
          >
            import
          </button>
        </details>
        {importStatus.kind === 'success' && (
          <div class="status-line ok">{importStatus.message}</div>
        )}
        {importStatus.kind === 'warnings' && (
          <div class="status-line warn">
            <strong>{importStatus.message}</strong>
            <ul>
              {(importStatus.warnings ?? []).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {importStatus.kind === 'error' && (
          <div class="status-line err">{importStatus.message}</div>
        )}
      </section>

      <section class="scenarios-library">
        <h3 class="section-h">Library ({scenarios.length})</h3>
        {scenarios.length === 0 ? (
          <div class="empty">No saved scenarios yet. Import one above.</div>
        ) : (
          <ul class="scenario-list">
            {scenarios.map((s) => {
              const isActive = s.id === activeScenarioId;
              return (
                <li
                  key={s.id}
                  class={'scenario-row' + (isActive ? ' active' : '')}
                  draggable
                  onDragStart={(e) => onScenarioDragStart(s, e)}
                  title="drag to export as .moxy.json"
                >
                  <div class="scenario-row-main">
                    <EditableField
                      className="scenario-row-name"
                      value={s.name}
                      onSave={(next) => void updateScenarioField(s, { name: next })}
                      allowEmpty={false}
                    />
                    <EditableField
                      className="scenario-row-desc"
                      value={s.description ?? ''}
                      onSave={(next) => void updateScenarioField(s, { description: next })}
                      placeholder="add description…"
                      multiline
                    />
                    <span class="scenario-row-meta">
                      {s.rules.length} rule{s.rules.length === 1 ? '' : 's'}
                      {isActive ? ' · active in this tab' : ''}
                    </span>
                  </div>
                  <div class="scenario-row-actions">
                    {isActive ? (
                      <button class="btn-sm" onClick={() => void send({ kind: 'sw:unload-scenario', tabId }).then(onChanged)}>
                        unload
                      </button>
                    ) : (
                      <button class="btn-sm" onClick={() => void loadScenario(s.id)}>
                        load
                      </button>
                    )}
                    <button class="btn-sm" onClick={() => exportScenario(s)} title="download as .moxy.json">
                      export
                    </button>
                    <button class="btn-sm" onClick={() => void duplicateScenario(s)}>
                      duplicate
                    </button>
                    <button class="btn-danger-sm" onClick={() => void deleteScenario(s.id, s.name)}>
                      delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
