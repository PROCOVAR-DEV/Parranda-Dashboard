"""
One-time migration: add Moa and Palma Soriano to the territories table and fix
the `orden` of Santiago de Cuba / Guantanamo, matching the new canonical order
in config.TERRITORY_DB_MAP.

Needed because seed_database() in app.py only seeds territories when the table
is empty (`if db.query(Territory).count() == 0`), so an existing installation
won't pick up new TERRITORY_DB_MAP entries on restart alone.

Safe to run more than once (idempotent - only inserts missing rows, only
updates orden when it's wrong).

Usage: venv\\Scripts\\python.exe migrate_add_territories.py
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import config
from models import Territory

engine = create_engine(config.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def main() -> None:
    db = SessionLocal()
    try:
        existing = {t.nombre: t for t in db.query(Territory).all()}
        print("Territorios actuales:", sorted((t.nombre, t.orden) for t in existing.values()))

        for entry in config.TERRITORY_DB_MAP:
            nombre, orden = entry["nombre"], entry["orden"]
            row = existing.get(nombre)
            if row is None:
                db.add(Territory(nombre=nombre, orden=orden))
                print(f"  + Insertando {nombre} (orden={orden})")
            elif row.orden != orden:
                print(f"  ~ Actualizando orden de {nombre}: {row.orden} -> {orden}")
                row.orden = orden

        db.commit()

        final = db.query(Territory).order_by(Territory.orden).all()
        print("\nTerritorios finales:")
        for t in final:
            print(f"  {t.orden}. {t.nombre}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
