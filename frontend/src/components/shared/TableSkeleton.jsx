import { TERRITORIES, SKUS } from "../../constants";

// Skeleton placeholder that mimics the pivot table structure while data loads:
// navy header + shimmer rows, sized off TERRITORIES/SKUS so it always matches
// the real table's column/row count.
const COLS = TERRITORIES.length + 2; // SKU name + territories + TOTAL
const ROWS = SKUS.length + 1; // SKU rows + TOTAL row

function ShimmerCell({ wide = false }) {
  return (
    <td className={`px-2 py-2 ${wide ? "min-w-[200px]" : ""}`}>
      <div className="h-3 rounded bg-gray-200 animate-pulse" style={{ width: wide ? "70%" : "60%" }} />
    </td>
  );
}

export default function TableSkeleton({ message = "Cargando..." }) {
  return (
    <div className="overflow-auto border border-gray-200 rounded-lg shadow-sm bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-navy">
            <th className="px-3 py-2 text-left min-w-[200px]">
              <div className="h-3 rounded bg-navy-dark animate-pulse w-20" />
            </th>
            {Array.from({ length: COLS - 1 }).map((_, i) => (
              <th key={i} className="px-2 py-2">
                <div className="h-3 rounded bg-navy-dark animate-pulse w-12 ml-auto" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: ROWS }).map((_, row) => (
            <tr key={row} className={row % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              <ShimmerCell wide />
              {Array.from({ length: COLS - 1 }).map((_, col) => (
                <ShimmerCell key={col} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-center text-xs text-gray-400 py-2">{message}</p>
    </div>
  );
}
