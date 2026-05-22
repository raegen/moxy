import type { Scenario } from '../../shared/types';

type Props = {
  active: Scenario | null;
  onUnload: () => void;
};

// Slim status bar shown above the tab nav. When a scenario is loaded in the
// current tab, the bar carries its name + an unload button; otherwise the bar
// is hidden entirely (no visual noise when there's nothing to indicate).
export function ScenarioBar({ active, onUnload }: Props) {
  if (!active) return null;
  return (
    <div class="scenario-bar" role="status">
      <span class="scenario-bar-label">scenario</span>
      <span class="scenario-bar-name" title={active.description ?? ''}>
        {active.name}
      </span>
      <button class="btn-sm" onClick={onUnload} title="unload from this tab">
        unload
      </button>
    </div>
  );
}
