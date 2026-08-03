import { SKUS } from "../../constants";

/**
 * SKU selector pills with focus-style selection:
 *  - Default: all 5 selected (activeSkus = null).
 *  - Clicking a pill while ALL are selected → selects ONLY that SKU.
 *  - Clicking further pills adds them to the selection.
 *  - Clicking an already-selected pill removes it; removing the last one
 *    (or selecting all 5) returns to "all selected".
 *
 * activeSkus: null = all | Set of codigo strings
 */
export function effectiveSkuSet(activeSkus) {
  if (!activeSkus || activeSkus.size === 0) return new Set(SKUS.map((s) => s.codigo));
  return activeSkus;
}

export function toggleSkuSelection(prev, codigo) {
  const allCodes = SKUS.map((s) => s.codigo);
  if (!prev || prev.size === 0) {
    // All selected → focus on the clicked SKU only
    return new Set([codigo]);
  }
  const next = new Set(prev);
  if (next.has(codigo)) {
    next.delete(codigo);
    if (next.size === 0) return null; // nothing left → back to all
  } else {
    next.add(codigo);
    if (next.size === allCodes.length) return null; // everything → all
  }
  return next;
}

export default function SkuPills({ activeSkus, onToggle, onReset }) {
  const effective = effectiveSkuSet(activeSkus);
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs text-gray-500 font-medium">SKU:</span>
      {SKUS.map((sku) => {
        const isActive = effective.has(sku.codigo);
        return (
          <button
            key={sku.codigo}
            onClick={() => onToggle(sku.codigo)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
              isActive
                ? "text-white border-transparent shadow-sm"
                : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
            }`}
            style={isActive ? { backgroundColor: sku.color, borderColor: sku.color } : {}}
          >
            {sku.label}
          </button>
        );
      })}
      {activeSkus && activeSkus.size > 0 && (
        <button
          onClick={onReset}
          className="px-2 py-1 rounded-full text-xs text-gray-400 border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          Todos
        </button>
      )}
    </div>
  );
}
