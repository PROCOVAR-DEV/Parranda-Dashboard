"""
Procovar - Parranda dashboard backend.

Run: python app.py  (Flask on port 5051)
"""
from __future__ import annotations

import logging
import os
import secrets
import sys
from datetime import timedelta

from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from models import Base, SKU, Territory, User

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

def _conectar_reintentando():
    """Abre la conexion a Postgres, reintentando si el fallo es pasajero.

    `pool_pre_ping` detecta conexiones MUERTAS, pero no ayuda cuando lo que
    falla es abrir una NUEVA. Y eso pasa: el DNS interno de Docker parpadea
    cuando un servicio se redespliega o la red del enjambre se reorganiza, y el
    contenedor deja de resolver el nombre del servidor de base de datos durante
    unos segundos.

    El 07/08/2026 le paso a analitics: 16 segundos sin resolver y seis trazas de
    error que llegaron por correo como si la aplicacion se hubiera caido. No se
    habia caido. Un parpadeo de segundos no es una averia y no debe despertar a
    nadie; solo si de verdad no vuelve en ~8 segundos se levanta el error.
    """
    import time

    import psycopg2
    from sqlalchemy.engine.url import make_url

    url = make_url(config.DATABASE_URL)
    espera = 0.25
    ultimo = None

    for intento in range(5):
        try:
            return psycopg2.connect(
                host=url.host,
                port=url.port or 5432,
                dbname=url.database,
                user=url.username,
                password=url.password,
                # Sin esto, un servidor que no contesta deja la peticion colgada
                # minutos: el error tarda mas en llegar que el propio arreglo.
                connect_timeout=5,
            )
        except psycopg2.OperationalError as e:
            ultimo = e
            if intento == 4:
                break
            time.sleep(espera)
            espera = min(espera * 2, 4)

    raise ultimo


engine = create_engine(
    config.DATABASE_URL,
    creator=_conectar_reintentando,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Session:
    return SessionLocal()


def _jwt_secret() -> str:
    """Use env var if set; otherwise generate once and persist next to app.py."""
    if config.JWT_SECRET_KEY:
        return config.JWT_SECRET_KEY
    secret_path = os.path.join(config.BASE_DIR, ".jwt_secret")
    if os.path.exists(secret_path):
        with open(secret_path, encoding="utf-8") as fh:
            return fh.read().strip()
    secret = secrets.token_hex(32)
    with open(secret_path, "w", encoding="utf-8") as fh:
        fh.write(secret)
    return secret


def seed_database() -> None:
    """Create tables and seed territories, SKUs, and the default admin."""
    from auth import hash_password

    Base.metadata.create_all(engine)

    # `create_all` crea tablas nuevas, pero NO aniade columnas a una tabla que ya
    # existe. Sin esto, la columna solo aparece en instalaciones nuevas y en la
    # que ya esta corriendo el login revienta al leer el usuario.
    #
    # `IF NOT EXISTS` lo hace repetible: se puede arrancar mil veces sin romper
    # nada, que es lo que hace falta cuando el arranque es automatico.
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_territories VARCHAR(400)"
        ))
    db = SessionLocal()
    try:
        if db.query(Territory).count() == 0:
            for entry in config.TERRITORY_DB_MAP:
                db.add(Territory(nombre=entry["nombre"], orden=entry["orden"]))
            logger.info("Seeded %d territories", len(config.TERRITORY_DB_MAP))

        if db.query(SKU).count() == 0:
            for s in config.PARRANDA_SKUS:
                db.add(SKU(codigo=s["codigo"], nombre=s["nombre"],
                           hl_factor=s["hl_factor"], orden=s["orden"]))
            logger.info("Seeded %d SKUs", len(config.PARRANDA_SKUS))

        if db.query(User).count() == 0:
            password = secrets.token_urlsafe(9)
            db.add(User(
                username="admin",
                password_hash=hash_password(password),
                display_name="Administrador",
                role="admin",
            ))
            print("=" * 60)
            print("  USUARIO ADMIN CREADO")
            print(f"  Usuario:    admin")
            print(f"  Contraseña: {password}")
            print("  Guarda esta contraseña — solo se muestra una vez.")
            print("=" * 60)

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["JWT_SECRET_KEY"] = _jwt_secret()
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=config.JWT_EXPIRES_HOURS)
    JWTManager(app)
    cors_origins = [o for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    CORS(app, resources={r"/api/*": {"origins": cors_origins}} if cors_origins else {})

    import auth
    from routes import clientes, meta, pedidos, portafolio, refresh, stock, users, ventas

    app.register_blueprint(auth.bp, url_prefix="/api")
    app.register_blueprint(ventas.bp, url_prefix="/api")
    app.register_blueprint(stock.bp, url_prefix="/api")
    app.register_blueprint(clientes.bp, url_prefix="/api")
    app.register_blueprint(portafolio.bp, url_prefix="/api")
    app.register_blueprint(pedidos.bp, url_prefix="/api")
    app.register_blueprint(meta.bp, url_prefix="/api")
    app.register_blueprint(users.bp, url_prefix="/api")
    app.register_blueprint(refresh.bp, url_prefix="/api")

    @app.route("/api/health")
    def health():
        return jsonify({"status": "ok", "app": "Procovar - Parranda"})

    return app


if __name__ == "__main__":
    seed_database()
    app = create_app()
    app.run(host="127.0.0.1", port=config.API_PORT, threaded=True)
