"""
User management (admin only).

GET    /api/users
POST   /api/users            { username, password, display_name, role }
PUT    /api/users/<id>       { display_name?, role?, active?, password? }
DELETE /api/users/<id>       (deactivates; never hard-deletes)
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from auth import admin_required, hash_password

bp = Blueprint("users", __name__)

VALID_ROLES = ("admin", "viewer")
VALID_TABS = ("ventas", "stock", "clientes", "portafolio", "pedidos", "metareal")


def _parse_allowed_tabs(raw) -> str | None:
    """
    Normalize an allowed_tabs payload (list of tab keys) into the stored
    comma-separated string. None / empty / all-tabs → None (= all visible).
    """
    if raw is None:
        return None
    tabs = [t for t in raw if t in VALID_TABS]
    if not tabs or set(tabs) == set(VALID_TABS):
        return None
    return ",".join(t for t in VALID_TABS if t in tabs)


def _parse_allowed_territories(raw) -> str | None:
    """Igual que `_parse_allowed_tabs`, pero con territorios.

    Se validan contra la lista canonica: si llegara un nombre que no existe se
    descarta en vez de guardarse, porque un territorio mal escrito no filtraria
    nada y la cuenta acabaria viendolo TODO — justo lo contrario de lo que se
    pretende al asignarlos.

    Vacio o "todos marcados" se guarda como NULL, que ya significa "todos": asi
    no hay dos formas distintas de decir lo mismo.
    """
    from config import TERRITORY_DB_MAP

    # La lista canonica sale de config, no de la base: es la misma que usa el
    # ETL y la que da /api/territorios, asi que no pueden discrepar.
    validos = [t["nombre"] for t in TERRITORY_DB_MAP]

    if raw is None:
        return None

    elegidos = [t for t in raw if t in validos]

    if not elegidos or set(elegidos) == set(validos):
        return None

    return ",".join(t for t in validos if t in elegidos)


@bp.route("/users")
@admin_required
def list_users():
    from app import get_db
    from models import User

    db = get_db()
    try:
        users = db.query(User).order_by(User.username).all()
        return jsonify([u.to_dict() for u in users])
    finally:
        db.close()


@bp.route("/users", methods=["POST"])
@admin_required
def create_user():
    from app import get_db
    from models import User

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = data.get("role") or "viewer"

    if not username or not password:
        return jsonify({"error": "Usuario y contraseña requeridos"}), 400
    if len(password) < 6:
        return jsonify({"error": "La contraseña debe tener al menos 6 caracteres"}), 400
    if role not in VALID_ROLES:
        return jsonify({"error": "Rol inválido"}), 400

    db = get_db()
    try:
        if db.query(User).filter(User.username == username).first():
            return jsonify({"error": "El usuario ya existe"}), 409
        user = User(
            username=username,
            password_hash=hash_password(password),
            display_name=(data.get("display_name") or "").strip(),
            role=role,
            allowed_tabs=_parse_allowed_tabs(data.get("allowed_tabs")),
            allowed_territories=_parse_allowed_territories(data.get("allowed_territories")),
        )
        db.add(user)
        db.commit()
        return jsonify(user.to_dict()), 201
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@bp.route("/users/<int:user_id>", methods=["PUT"])
@admin_required
def update_user(user_id: int):
    from app import get_db
    from models import User

    data = request.get_json(silent=True) or {}
    db = get_db()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "Usuario no encontrado"}), 404

        if "display_name" in data:
            user.display_name = (data.get("display_name") or "").strip()
        if "role" in data:
            role = data.get("role")
            if role not in VALID_ROLES:
                return jsonify({"error": "Rol inválido"}), 400
            if user.id == int(get_jwt_identity()) and role != "admin":
                return jsonify({"error": "No puedes quitarte tu propio rol de administrador"}), 400
            user.role = role
        if "active" in data:
            if user.id == int(get_jwt_identity()) and not data.get("active"):
                return jsonify({"error": "No puedes desactivar tu propia cuenta"}), 400
            user.active = bool(data.get("active"))
        if "allowed_tabs" in data:
            user.allowed_tabs = _parse_allowed_tabs(data.get("allowed_tabs"))
        if "allowed_territories" in data:
            user.allowed_territories = _parse_allowed_territories(
                data.get("allowed_territories")
            )
        if data.get("password"):
            if len(data["password"]) < 6:
                return jsonify({"error": "La contraseña debe tener al menos 6 caracteres"}), 400
            user.password_hash = hash_password(data["password"])

        db.commit()
        return jsonify(user.to_dict())
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@bp.route("/users/<int:user_id>", methods=["DELETE"])
@admin_required
def deactivate_user(user_id: int):
    from app import get_db
    from models import User

    db = get_db()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "Usuario no encontrado"}), 404
        if user.id == int(get_jwt_identity()):
            return jsonify({"error": "No puedes desactivar tu propia cuenta"}), 400
        user.active = False
        db.commit()
        return jsonify({"status": "ok"})
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
