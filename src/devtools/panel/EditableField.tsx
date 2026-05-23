import { useEffect, useRef, useState } from 'preact/hooks';

// Double-click to edit, Enter to save, Esc to revert, blur to save.
// Used by the scenario library for both name and description fields.
//
// `value` is the source of truth; `onSave` is the commit handler.
// `placeholder` shows when value is empty (e.g. "Add description…").
// `allowEmpty=false` reverts blank saves to the previous value (names).
// `multiline=true` swaps <input> for <textarea> (descriptions).

export function EditableField({
  value,
  onSave,
  placeholder,
  allowEmpty = true,
  multiline = false,
  className,
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  multiline?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Re-sync when the upstream value changes while we're not editing.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Auto-focus + select all on entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (!allowEmpty && next === '') {
      setDraft(value);
      setEditing(false);
      return;
    }
    if (next !== value) onSave(next);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Enter' && multiline && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={inputRef as preact.RefObject<HTMLTextAreaElement>}
          class={'editable-field editing ' + (className ?? '')}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onBlur={commit}
          onKeyDown={onKey}
          rows={2}
          placeholder={placeholder}
        />
      );
    }
    return (
      <input
        ref={inputRef as preact.RefObject<HTMLInputElement>}
        class={'editable-field editing ' + (className ?? '')}
        type="text"
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={onKey}
        placeholder={placeholder}
      />
    );
  }

  const isEmpty = value === '';
  return (
    <span
      class={
        'editable-field ' + (isEmpty ? 'empty ' : '') + (className ?? '')
      }
      onDblClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="double-click to edit"
    >
      {isEmpty ? placeholder ?? '' : value}
    </span>
  );
}
