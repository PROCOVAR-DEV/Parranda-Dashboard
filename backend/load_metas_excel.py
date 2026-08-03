"""
Parse every "<Mes> Meta vs Real HL.xlsx" in Documents\\HL Meta and load the
Meta Total values (HL per SKU per territory) into the dashboard via the API.

Layout per file (validated against Junio 2026): territory blocks whose header
row is [<territorio>, P1500, P500, P330, M1500, M330, TOTAL]; the row labelled
"Meta Total" right below holds the values. The "Resumen" block is skipped
(it is a sum of the others). "Dias Laboral Total" cell → dias_totales.

Usage:
  python load_metas_excel.py <admin_password> --dry-run   # parse + print only
  python load_metas_excel.py <admin_password>             # parse + POST
"""
from __future__ import annotations

import os
import sys
import unicodedata

import openpyxl
import requests

BASE = "http://127.0.0.1:5051/api"
ROOT = os.path.join(os.environ["USERPROFILE"], "Documents", "HL Meta")

SKU_COLS = ["P1500", "P500", "P330", "M1500", "M330"]

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

# Sheet spelling variants → canonical territory names used by the dashboard
TERRITORY_ALIASES = {
    "havana": "Havana",
    "habana": "Havana",
    "sancti spiritu": "Sancti Spíritus",
    "sancti spiritus": "Sancti Spíritus",
    "s-spiritus": "Sancti Spíritus",
    "camaguey": "Camagüey",
    "las tunas": "Las Tunas",
    "tunas": "Las Tunas",
    "holguin": "Holguín",
    "santiago de cuba": "Santiago de Cuba",
    "santiago": "Santiago de Cuba",
    "guantanamo": "Guantánamo",
}
SKIP_BLOCKS = {"resumen", "bayamo"}  # Resumen = derived; Bayamo excluded from dashboard


def _norm(s) -> str:
    """lowercase + strip accents/whitespace for matching."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.strip().lower()


def parse_file(path: str) -> tuple[dict[str, dict[str, float]], int | None]:
    """
    Returns ({territorio: {sku: hl}}, dias_totales | None).
    Scans all sheets for territory blocks and the 'Dias Laboral Total' cell.
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    metas: dict[str, dict[str, float]] = {}
    dias_totales: int | None = None

    for ws in wb.worksheets:
        grid = {(c.row, c.column): c.value for row in ws.iter_rows() for c in row if c.value is not None}

        for (r, col), value in sorted(grid.items()):
            label = _norm(value)

            if label in ("dias laboral total", "dias laboral") and dias_totales is None:
                right = grid.get((r, col + 1))
                if isinstance(right, (int, float)) and 0 < right <= 31:
                    dias_totales = int(right)
                continue

            # Block header: territory name followed by P1500 in the next column
            if _norm(grid.get((r, col + 1))) != "p1500":
                continue
            if label in SKIP_BLOCKS:
                continue
            territorio = TERRITORY_ALIASES.get(label)
            if territorio is None:
                if label:
                    print(f"    ! bloque ignorado (territorio desconocido): {value!r}")
                continue

            # Map SKU headers to columns. Older files have fewer SKUs (e.g.
            # Nov 2025 has no M1500) — missing ones get meta 0.
            sku_col = {}
            for offset in range(1, len(SKU_COLS) + 2):
                header = _norm(grid.get((r, col + offset)))
                for sku in SKU_COLS:
                    if header == sku.lower():
                        sku_col[sku] = col + offset
            if len(sku_col) < 3:
                print(f"    ! columnas SKU insuficientes en bloque {territorio} ({path})")
                continue

            for dr in range(1, 4):
                if _norm(grid.get((r + dr, col))) == "meta total":
                    values = {}
                    for sku in SKU_COLS:
                        v = grid.get((r + dr, sku_col[sku])) if sku in sku_col else 0.0
                        values[sku] = round(float(v), 2) if isinstance(v, (int, float)) else 0.0
                    if territorio in metas:
                        print(f"    ! bloque duplicado para {territorio}, se conserva el primero")
                    else:
                        metas[territorio] = values
                    break

    return metas, dias_totales


def find_files() -> list[tuple[str, str]]:
    """Returns [(mes 'YYYY-MM', path)] for every '<Mes> Meta vs Real HL.xlsx'."""
    out = []
    for dirpath, _dirs, files in os.walk(ROOT):
        for fname in files:
            norm = _norm(fname)
            if fname.startswith("~$") or not norm.endswith(".xlsx") or "meta vs real" not in norm:
                continue
            month = next((n for name, n in MONTHS.items() if norm.startswith(name)), None)
            year = next((y for y in ("2024", "2025", "2026", "2027") if y in dirpath or y in fname), None)
            if month is None or year is None:
                print(f"  ? no pude deducir mes/año de: {os.path.join(dirpath, fname)}")
                continue
            out.append((f"{year}-{month:02d}", os.path.join(dirpath, fname)))
    return sorted(out)


def main() -> None:
    password = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    files = find_files()
    print(f"Archivos encontrados: {len(files)}")

    parsed = []
    for mes, path in files:
        print(f"\n{mes}  <-  {os.path.relpath(path, ROOT)}")
        metas, dias = parse_file(path)
        total = sum(sum(v.values()) for v in metas.values())
        print(f"  territorios={len(metas)} dias_totales={dias} total={total:,.0f} HL")
        for t, vals in metas.items():
            print(f"    {t:18s} " + "  ".join(f"{s}={vals[s]:g}" for s in SKU_COLS))
        if metas:
            parsed.append((mes, metas, dias))

    if dry_run:
        print("\n(dry-run: no se envió nada)")
        return

    token = requests.post(f"{BASE}/auth/login",
                          json={"username": "admin", "password": password}).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    for mes, metas, dias in parsed:
        items = [
            {"territorio": t, "sku_codigo": sku, "hl": hl}
            for t, vals in metas.items() for sku, hl in vals.items()
        ]
        body = {"mes": mes, "items": items}
        if dias:
            body["dias_totales"] = dias
        res = requests.post(f"{BASE}/metas", json=body, headers=headers)
        print(f"POST {mes}: {res.status_code} {res.json()}")


if __name__ == "__main__":
    main()
