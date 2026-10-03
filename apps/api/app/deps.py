"""FastAPI dependencies — auth, db, rate limiting."""
from __future__ import annotations

import datetime
from fastapi import Header, HTTPException
import jwt
from app.db import get_conn, row_to_dict
from app.core.config import settings


def current_user(authorization: str | None = Header(default=None)):
    """Resolve bearer token → user dict. Supports HS256 JWT access tokens and legacy DB session tokens."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token. Use Authorization: Bearer <token>")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token")

    now_iso = datetime.datetime.utcnow().isoformat() + "Z"
    p = "%s" if settings.is_postgres() else "?"

    # 1. Native QuantOS JWT (signed by settings.secret_key)
    user_id = ""
    try:
        decoded = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        if decoded.get("typ") == "access":
            user_id = str(decoded.get("sub") or "")
    except Exception:
        user_id = ""

    if user_id:
        with get_conn() as conn:
            # Active session check
            row = conn.execute(f"""
                SELECT u.id, u.email, u.name, u.onboarding_completed
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token = {p} AND s.user_id = {p} AND s.expires_at > {p}
            """, (token, user_id, now_iso)).fetchone()
            if row:
                return row_to_dict(row)
            # Direct valid JWT user lookup
            row = conn.execute(f"SELECT id, email, name, onboarding_completed FROM users WHERE id = {p}", (user_id,)).fetchone()
            if row:
                return row_to_dict(row)

    # 2. Supabase Auth JWT
    try:
        supabase_secret = getattr(settings, "supabase_jwt_secret", "")
        if supabase_secret:
            try:
                unverified = jwt.decode(token, supabase_secret, algorithms=["HS256"])
            except Exception:
                unverified = jwt.decode(token, options={"verify_signature": False})
        else:
            unverified = jwt.decode(token, options={"verify_signature": False})

        exp = unverified.get("exp")
        now_ts = datetime.datetime.utcnow().timestamp()
        if exp and exp < now_ts:
            raise HTTPException(status_code=401, detail="Session expired. Please log in again.")

        sub = str(unverified.get("sub") or "")
        email = str(unverified.get("email") or "")
        iss = str(unverified.get("iss") or "")
        role = str(unverified.get("role") or "")
        aud = str(unverified.get("aud") or "")

        is_supabase = (
            "supabase.co" in iss
            or role == "authenticated"
            or aud == "authenticated"
            or (sub and "@" in email)
        )

        if is_supabase and sub:
            user_meta = unverified.get("user_metadata") or {}
            name = ""
            if isinstance(user_meta, dict):
                name = str(user_meta.get("name") or user_meta.get("full_name") or "")
            if not name and email:
                name = email.split("@")[0]

            with get_conn() as conn:
                row = conn.execute(f"SELECT id, email, name, onboarding_completed FROM users WHERE id = {p}", (sub,)).fetchone()
                if row:
                    return row_to_dict(row)

                if email:
                    row = conn.execute(f"SELECT id, email, name, onboarding_completed FROM users WHERE email = {p}", (email,)).fetchone()
                    if row:
                        return row_to_dict(row)

                # Provision user record in local DB for relational integrity
                user_email = email or f"{sub}@supabase.user"
                conn.execute(
                    f"""
                    INSERT INTO users (id, email, name, password_hash, onboarding_completed, created_at)
                    VALUES ({p}, {p}, {p}, {p}, 1, {p})
                    """,
                    (sub, user_email, name or "Trader", "supabase_auth", now_iso),
                )
                conn.commit()
                return {
                    "id": sub,
                    "email": user_email,
                    "name": name or "Trader",
                    "onboarding_completed": True,
                }
    except HTTPException:
        raise
    except Exception:
        pass

    # 3. Legacy session token in sessions table
    with get_conn() as conn:
        row = conn.execute(f"""
            SELECT u.id, u.email, u.name, u.onboarding_completed
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = {p} AND s.expires_at > {p}
        """, (token, now_iso)).fetchone()
        if row:
            return row_to_dict(row)

    raise HTTPException(status_code=401, detail="Invalid or expired token. Please log in again.")
