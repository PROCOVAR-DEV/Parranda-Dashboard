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
