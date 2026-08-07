"""
Authentication: JWT login + role enforcement.

POST /api/auth/login   { username, password } → { token, user }
GET  /api/auth/me      → current user info
"""
from __future__ import annotations

import functools

import bcrypt
from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token, get_jwt, get_jwt_identity, jwt_required, verify_jwt_in_request,
)

bp = Blueprint("auth", __name__)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def check_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def admin_required(fn):
    """Route decorator: valid JWT AND role=admin."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        if get_jwt().get("role") != "admin":
            return jsonify({"error": "Se requiere rol de administrador"}), 403
        return fn(*args, **kwargs)
    return wrapper


@bp.route("/auth/login", methods=["POST"])
def login():
    from app import get_db
    from models import User

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Usuario y contraseña requeridos"}), 400

    db = get_db()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user or not user.active or not check_password(password, user.password_hash):
            return jsonify({"error": "Credenciales inválidas"}), 401

        token = create_access_token(
            identity=str(user.id),
            additional_claims={"role": user.role, "username": user.username},
        )
        return jsonify({"token": token, "user": user.to_dict()})
    finally:
        db.close()


@bp.route("/auth/me")
@jwt_required()
def me():
    from app import get_db
    from models import User

    db = get_db()
    try:
        user = db.get(User, int(get_jwt_identity()))
        if not user or not user.active:
            return jsonify({"error": "Usuario no encontrado"}), 401
        return jsonify(user.to_dict())
    finally:
        db.close()


def territorios_permitidos(solicitados=None):
    """Los territorios que ESTA petición puede ver de verdad.

    Es el ÚNICO sitio donde se decide. Seis rutas leían
    `request.args.getlist("territorio")` por su cuenta y filtraban con lo que
    llegara: si cada una aplica el permiso a su manera, tarde o temprano una se
    lo salta y enseña datos de otra sucursal. Eso no falla con un error — falla
    enseñando cifras que no tocan, que es la forma cara de fallar.

    Reglas:

      - **admin**: lo ve todo. Lo que pida es lo que se le da.
      - **con territorios asignados**: se le da la INTERSECCIÓN de lo que pide
        con lo suyo. Si pide uno que no es suyo, no sale — no da error, sale
        vacío, que es lo que corresponde a algo que para él no existe.
      - **con territorios asignados y sin pedir nada**: se le dan LOS SUYOS. Sin
        esto, "sin filtro" significaría "todos" y vería el país entero.
      - **sin territorios asignados**: como hasta ahora, lo ve todo.

    Devuelve una lista de nombres, o None cuando significa "todos" (que es lo
    que las consultas ya entienden como "no filtres").
    """
    from app import get_db
    from models import User

    solicitados = [t for t in (solicitados or []) if t]

    try:
        claims = get_jwt()
    except Exception:
        # Sin token no se llega aqui (las rutas van con @jwt_required), pero si
        # alguna vez se llamara suelta, lo prudente es no dar nada.
        return solicitados or None

    if claims.get("role") == "admin":
        return solicitados or None

    db = get_db()
    try:
        user = db.get(User, int(get_jwt_identity()))
        suyos = [t for t in ((user.allowed_territories if user else "") or "").split(",") if t]
    finally:
        db.close()

    if not suyos:
        return solicitados or None

    if not solicitados:
        return suyos

    permitidos = [t for t in solicitados if t in suyos]

    # Pidio SOLO territorios ajenos: se devuelve una lista imposible en vez de
    # None. Si se devolviera None, "sin filtro" se leeria como "todos" y veria
    # justo lo que no debe.
    return permitidos or ["__ninguno__"]
