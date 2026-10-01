"""Auth routes — email OTP registration, login, JWT access, refresh, password reset, logout, profile."""
from __future__ import annotations

import datetime
import hashlib
import logging
import secrets
import smtplib
from email.message import EmailMessage
from typing import Any, Dict

import jwt
from fastapi import APIRouter, HTTPException, Depends, Header, Request
from pydantic import BaseModel, EmailStr

from app.db import get_conn, hash_password, now, row_to_dict, verify_password
from app.core.config import settings
from app.deps import current_user

router = APIRouter()
security_logger = logging.getLogger("quantos.security")

_LOGIN_ATTEMPTS: Dict[str, list[float]] = {}
_LOGIN_LIMIT = 5
_LOGIN_WINDOW_SECONDS = 15 * 60
_OTP_ATTEMPTS: Dict[str, int] = {}
_MAX_OTP_ATTEMPTS = 5
_REDIS_CLIENT: Any = None
_REDIS_UNAVAILABLE = False


def _utcnow() -> datetime.datetime:
    return datetime.datetime.utcnow()


def _iso_exp(seconds: int) -> str:
    exp = _utcnow() + datetime.timedelta(seconds=seconds)
    return exp.replace(microsecond=0).isoformat() + "Z"


def _otp_expiry() -> str:
    return _iso_exp(600)


def _generate_otp() -> str:
    """Return a six-digit OTP using cryptographic randomness."""
    return f"{secrets.randbelow(900000) + 100000}"


def _is_expired(value: str) -> bool:
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "")) < _utcnow()
    except Exception:
        return True


def _ph(password: str) -> str:
    return hash_password(password)


def _p() -> str:
    return "%s" if settings.is_postgres() else "?"


def _client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and settings.is_prod:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _hash_email(email: str) -> str:
    normalized = (email or "").lower().strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16] if normalized else ""


def _audit(event: str, *, email: str = "", user_id: str = "", request: Request | None = None, outcome: str = "ok") -> None:
    """Emit safe auth audit metadata without OTPs, passwords, or tokens."""
    security_logger.info(
        "auth_event event=%s outcome=%s email_hash=%s user_id=%s ip=%s",
        event,
        outcome,
        _hash_email(email),
        user_id or "",
        _client_ip(request),
    )


def _get_redis_client():
    """Return a Redis client for distributed auth limits, or None on failure."""
    global _REDIS_CLIENT, _REDIS_UNAVAILABLE
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    if _REDIS_UNAVAILABLE or not settings.redis_url:
        return None
    try:
        from redis import Redis
        client = Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
        client.ping()
        _REDIS_CLIENT = client
        return _REDIS_CLIENT
    except Exception:
        _REDIS_UNAVAILABLE = True
        return None


def _login_key(email: str, request: Request) -> str:
    host = _client_ip(request)
    return f"{email}:{host}"


def _redis_login_key(email: str, request: Request) -> str:
    digest = hashlib.sha256(_login_key(email, request).encode("utf-8")).hexdigest()
    return f"auth:login_fail:{digest}"


def _check_login_rate_limit(email: str, request: Request) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            raw = client.get(_redis_login_key(email, request))
            count = int(raw or 0)
            if count >= _LOGIN_LIMIT:
                _audit("login_rate_limited", email=email, request=request, outcome="blocked")
                raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")
            return
        except HTTPException:
            raise
        except Exception:
            pass

    ts = datetime.datetime.utcnow().timestamp()
    key = _login_key(email, request)
    attempts = [t for t in _LOGIN_ATTEMPTS.get(key, []) if ts - t < _LOGIN_WINDOW_SECONDS]
    if len(attempts) >= _LOGIN_LIMIT:
        _audit("login_rate_limited", email=email, request=request, outcome="blocked")
        raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")
    _LOGIN_ATTEMPTS[key] = attempts


def _record_failed_login(email: str, request: Request) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            key = _redis_login_key(email, request)
            count = client.incr(key)
            if int(count) == 1:
                client.expire(key, _LOGIN_WINDOW_SECONDS)
            return
        except Exception:
            pass

    ts = datetime.datetime.utcnow().timestamp()
    key = _login_key(email, request)
    attempts = [t for t in _LOGIN_ATTEMPTS.get(key, []) if ts - t < _LOGIN_WINDOW_SECONDS]
    attempts.append(ts)
    _LOGIN_ATTEMPTS[key] = attempts


def _clear_failed_logins(email: str, request: Request) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            client.delete(_redis_login_key(email, request))
        except Exception:
            pass
    _LOGIN_ATTEMPTS.pop(_login_key(email, request), None)


def _get_user_by_email(conn, email: str):
    p = _p()
    return conn.execute(f"SELECT id,email,name,password_hash,onboarding_completed FROM users WHERE email={p}", (email,)).fetchone()


def _get_user_by_id(conn, user_id: str):
    p = _p()
    return conn.execute(f"SELECT id,email,name,password_hash,onboarding_completed FROM users WHERE id={p}", (user_id,)).fetchone()


def _create_access_token(user_id: str) -> str:
    exp = _utcnow() + datetime.timedelta(seconds=settings.access_token_ttl_seconds)
    return jwt.encode(
        {"sub": user_id, "typ": "access", "jti": secrets.token_urlsafe(24), "exp": exp},
        settings.secret_key,
        algorithm="HS256",
    )


def _create_refresh_token(conn, user_id: str) -> str:
    exp = _utcnow() + datetime.timedelta(seconds=settings.refresh_ttl_seconds)
    token = jwt.encode(
        {"sub": user_id, "typ": "refresh", "jti": secrets.token_urlsafe(32), "exp": exp},
        settings.secret_key,
        algorithm="HS256",
    )
    p = _p()
    conn.execute(
        f"INSERT INTO refresh_tokens(token,user_id,expires_at,revoked,created_at) VALUES({p},{p},{p},{p},{p})",
        (token, user_id, _iso_exp(settings.refresh_ttl_seconds), 0, now()),
    )
    return token


def _create_legacy_session(conn, user_id: str, access_token: str) -> None:
    # Keep the existing sessions table so older frontend calls and Swagger auth still work.
    p = _p()
    conn.execute(f"INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES({p},{p},{p},{p})", (access_token, user_id, _iso_exp(settings.access_token_ttl_seconds), now()))


def _auth_response(conn, user: Dict[str, Any]) -> Dict[str, Any]:
    access = _create_access_token(user["id"])
    refresh = _create_refresh_token(conn, user["id"])
    _create_legacy_session(conn, user["id"], access)
    return {
        "token": access,
        "access_token": access,
        "refresh_token": refresh,
        "expires_in": settings.access_token_ttl_seconds,
        "user": {"id": user["id"], "email": user["email"], "name": user.get("name") or "", "onboarding_completed": bool(user.get("onboarding_completed"))},
    }


def _send_otp_email(to_email: str, otp: str, purpose: str) -> bool:
    if not settings.smtp_host:
        return False
    msg = EmailMessage()
    msg["Subject"] = f"QuantOS {purpose} OTP"
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.set_content(f"Your QuantOS {purpose} OTP is: {otp}\n\nThis OTP expires in 10 minutes. If you did not request it, ignore this email.")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_tls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception as exc:
        print(f"[QuantOS][email] OTP delivery failed for {to_email}: {exc}")
        return False


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str = ""


class VerifyRegisterRequest(BaseModel):
    email: EmailStr
    otp: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetVerify(BaseModel):
    email: EmailStr
    otp: str
    new_password: str


@router.post("/register/request-otp", summary="Generate and email an OTP for first-time registration")
def request_registration_otp(payload: RegisterRequest, request: Request):
    email = payload.email.lower().strip()
    if len(payload.password) < 6:
        _audit("registration_otp_requested", email=email, request=request, outcome="weak_password")
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    with get_conn() as conn:
        if _get_user_by_email(conn, email):
            _audit("registration_otp_requested", email=email, request=request, outcome="already_registered")
            raise HTTPException(status_code=409, detail="This email id is already registered. Go for login.")
        p = _p()
        otp = _generate_otp()
        _OTP_ATTEMPTS.pop(email, None)
        if settings.is_postgres():
            conn.execute(
                """
                INSERT INTO registration_otps(email,name,password_hash,otp_code,expires_at,created_at)
                VALUES(%s,%s,%s,%s,%s,%s)
                ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,otp_code=EXCLUDED.otp_code,expires_at=EXCLUDED.expires_at,created_at=EXCLUDED.created_at
                """,
                (email, payload.name.strip(), _ph(payload.password), otp, _otp_expiry(), now()),
            )
        else:
            conn.execute(f"INSERT OR REPLACE INTO registration_otps(email,name,password_hash,otp_code,expires_at,created_at) VALUES({p},{p},{p},{p},{p},{p})", (email, payload.name.strip(), _ph(payload.password), otp, _otp_expiry(), now()))
        conn.commit()
    sent = _send_otp_email(email, otp, "registration")
    _audit("registration_otp_requested", email=email, request=request, outcome="sent" if sent else "dev_generated")
    if not sent and not settings.email_otp_dev_return:
        raise HTTPException(status_code=503, detail="Email OTP delivery is not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM or enable EMAIL_OTP_DEV_RETURN=true for local development only.")
    resp = {"message": "OTP sent to your email." if sent else "OTP generated in local-dev mode. Configure SMTP for production email delivery.", "email": email, "email_sent": sent}
    if not sent and settings.email_otp_dev_return:
        resp["otp"] = otp
    return resp


@router.post("/register/verify", summary="Verify OTP and create account")
def verify_registration(payload: VerifyRegisterRequest, request: Request):
    email = payload.email.lower().strip()
    otp = payload.otp.strip()
    if not otp:
        _audit("registration_verify", email=email, request=request, outcome="missing_otp")
        raise HTTPException(status_code=400, detail="OTP is required")
    with get_conn() as conn:
        if _get_user_by_email(conn, email):
            _audit("registration_verify", email=email, request=request, outcome="already_registered")
            raise HTTPException(status_code=409, detail="This email id is already registered. Go for login.")
        p = _p()
        row = conn.execute(f"SELECT email,name,password_hash,otp_code,expires_at FROM registration_otps WHERE email={p}", (email,)).fetchone()
        if not row:
            _audit("registration_verify", email=email, request=request, outcome="otp_not_found")
            raise HTTPException(status_code=400, detail="OTP not found. Please generate a new OTP.")
        rec = row_to_dict(row)
        if _is_expired(rec.get("expires_at", "")):
            conn.execute(f"DELETE FROM registration_otps WHERE email={p}", (email,))
            conn.commit()
            _OTP_ATTEMPTS.pop(email, None)
            _audit("registration_verify", email=email, request=request, outcome="otp_expired")
            raise HTTPException(status_code=400, detail="OTP expired. Please generate a new OTP.")
        if str(rec.get("otp_code")) != otp:
            attempts = _OTP_ATTEMPTS.get(email, 0) + 1
            _OTP_ATTEMPTS[email] = attempts
            if attempts >= _MAX_OTP_ATTEMPTS:
                conn.execute(f"DELETE FROM registration_otps WHERE email={p}", (email,))
                conn.commit()
                _OTP_ATTEMPTS.pop(email, None)
                _audit("registration_verify", email=email, request=request, outcome="otp_max_attempts_exceeded")
                raise HTTPException(status_code=400, detail="Too many failed attempts. This OTP has been invalidated. Please generate a new OTP.")
            _audit("registration_verify", email=email, request=request, outcome="invalid_otp")
            remaining = _MAX_OTP_ATTEMPTS - attempts
            raise HTTPException(status_code=400, detail=f"Invalid OTP. {remaining} attempt(s) remaining.")
        _OTP_ATTEMPTS.pop(email, None)
        user_id = __import__('uuid').uuid4().hex
        try:
            conn.execute(f"INSERT INTO users(id,email,name,password_hash,onboarding_completed,created_at) VALUES({p},{p},{p},{p},{p},{p})", (user_id, email, rec.get("name", ""), rec["password_hash"], 0, now()))
            conn.execute(f"INSERT INTO onboarding_state(user_id,step,completed_steps_json,updated_at) VALUES({p},{p},{p},{p})", (user_id, "welcome", "[]", now()))
            conn.execute(f"DELETE FROM registration_otps WHERE email={p}", (email,))
            user = {"id": user_id, "email": email, "name": rec.get("name", ""), "onboarding_completed": 0}
            resp = _auth_response(conn, user)
            conn.commit()
            _audit("registration_verify", email=email, user_id=user_id, request=request, outcome="created")
        except Exception as e:
            err = str(e)
            if "UNIQUE" in err.upper() or "unique" in err.lower():
                _audit("registration_verify", email=email, request=request, outcome="unique_conflict")
                raise HTTPException(status_code=409, detail="This email id is already registered. Go for login.")
            _audit("registration_verify", email=email, request=request, outcome="failed")
            raise HTTPException(status_code=400, detail=f"Registration failed: {err}")
    return {**resp, "onboarding_step": "welcome"}


@router.post("/register", summary="Create a new account using OTP flow")
def register(payload: RegisterRequest, request: Request):
    return request_registration_otp(payload, request)


@router.post("/login", summary="Login and receive access + refresh tokens")
def login(payload: LoginRequest, request: Request):
    email = payload.email.lower().strip()
    _check_login_rate_limit(email, request)
    with get_conn() as conn:
        row = _get_user_by_email(conn, email)
        user = row_to_dict(row) if row else {}
        if not row or not verify_password(payload.password, user.get("password_hash", "")):
            _record_failed_login(email, request)
            _audit("login", email=email, request=request, outcome="invalid_credentials")
            raise HTTPException(status_code=401, detail="Invalid email or password")
        resp = _auth_response(conn, user)
        conn.commit()
    _clear_failed_logins(email, request)
    _audit("login", email=email, user_id=str(user.get("id", "")), request=request, outcome="success")
    return resp


@router.post("/refresh", summary="Rotate refresh token and issue a new access token")
def refresh(payload: RefreshRequest, request: Request):
    try:
        decoded = jwt.decode(payload.refresh_token, settings.secret_key, algorithms=["HS256"])
        if decoded.get("typ") != "refresh":
            raise ValueError("not a refresh token")
        user_id = decoded.get("sub")
    except Exception:
        _audit("refresh", request=request, outcome="invalid_token")
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    p = _p()
    with get_conn() as conn:
        row = conn.execute(f"SELECT * FROM refresh_tokens WHERE token={p} AND user_id={p} AND revoked=0 AND expires_at>{p}", (payload.refresh_token, user_id, now())).fetchone()
        if not row:
            _audit("refresh", user_id=str(user_id or ""), request=request, outcome="revoked_or_expired")
            raise HTTPException(status_code=401, detail="Refresh token expired or revoked")
        user_row = _get_user_by_id(conn, user_id)
        if not user_row:
            _audit("refresh", user_id=str(user_id or ""), request=request, outcome="user_not_found")
            raise HTTPException(status_code=401, detail="User not found")
        conn.execute(f"UPDATE refresh_tokens SET revoked=1 WHERE token={p}", (payload.refresh_token,))
        resp = _auth_response(conn, row_to_dict(user_row))
        conn.commit()
    _audit("refresh", user_id=str(user_id or ""), request=request, outcome="rotated")
    return resp


@router.post("/password-reset/request-otp", summary="Send password reset OTP")
def request_password_reset(payload: PasswordResetRequest, request: Request):
    email = payload.email.lower().strip()
    with get_conn() as conn:
        if not _get_user_by_email(conn, email):
            _audit("password_reset_otp_requested", email=email, request=request, outcome="unknown_email")
            return {"message": "If that email exists, a reset OTP has been sent.", "email_sent": False}
        otp = _generate_otp()
        p = _p()
        _OTP_ATTEMPTS.pop(email, None)
        if settings.is_postgres():
            conn.execute("INSERT INTO password_reset_otps(email,otp_code,expires_at,created_at) VALUES(%s,%s,%s,%s) ON CONFLICT(email) DO UPDATE SET otp_code=EXCLUDED.otp_code,expires_at=EXCLUDED.expires_at,created_at=EXCLUDED.created_at", (email, otp, _otp_expiry(), now()))
        else:
            conn.execute(f"INSERT OR REPLACE INTO password_reset_otps(email,otp_code,expires_at,created_at) VALUES({p},{p},{p},{p})", (email, otp, _otp_expiry(), now()))
        conn.commit()
    sent = _send_otp_email(email, otp, "password reset")
    _audit("password_reset_otp_requested", email=email, request=request, outcome="sent" if sent else "dev_generated")
    resp = {"message": "If that email exists, a reset OTP has been sent.", "email_sent": sent}
    if not sent and settings.email_otp_dev_return:
        resp["otp"] = otp
    return resp


@router.post("/password-reset/verify", summary="Verify password reset OTP and set new password")
def verify_password_reset(payload: PasswordResetVerify, request: Request):
    email = payload.email.lower().strip()
    if len(payload.new_password) < 6:
        _audit("password_reset_verify", email=email, request=request, outcome="weak_password")
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    p = _p()
    with get_conn() as conn:
        row = conn.execute(f"SELECT otp_code,expires_at FROM password_reset_otps WHERE email={p}", (email,)).fetchone()
        if not row:
            _audit("password_reset_verify", email=email, request=request, outcome="otp_not_found")
            raise HTTPException(status_code=400, detail="OTP not found. Please request a new reset OTP.")
        rec = row_to_dict(row)
        if _is_expired(rec.get("expires_at", "")):
            conn.execute(f"DELETE FROM password_reset_otps WHERE email={p}", (email,))
            conn.commit()
            _OTP_ATTEMPTS.pop(email, None)
            _audit("password_reset_verify", email=email, request=request, outcome="otp_expired")
            raise HTTPException(status_code=400, detail="OTP expired. Please request a new reset OTP.")
        if str(rec.get("otp_code")) != payload.otp.strip():
            attempts = _OTP_ATTEMPTS.get(email, 0) + 1
            _OTP_ATTEMPTS[email] = attempts
            if attempts >= _MAX_OTP_ATTEMPTS:
                conn.execute(f"DELETE FROM password_reset_otps WHERE email={p}", (email,))
                conn.commit()
                _OTP_ATTEMPTS.pop(email, None)
                _audit("password_reset_verify", email=email, request=request, outcome="max_attempts_exceeded")
                raise HTTPException(status_code=400, detail="Too many failed attempts. This OTP has been invalidated. Please request a new reset OTP.")
            _audit("password_reset_verify", email=email, request=request, outcome="invalid_otp")
            remaining = _MAX_OTP_ATTEMPTS - attempts
            raise HTTPException(status_code=400, detail=f"Invalid OTP. {remaining} attempt(s) remaining.")
        _OTP_ATTEMPTS.pop(email, None)
        conn.execute(f"UPDATE users SET password_hash={p} WHERE email={p}", (_ph(payload.new_password), email))
        conn.execute(f"DELETE FROM password_reset_otps WHERE email={p}", (email,))
        conn.commit()
    _audit("password_reset_verify", email=email, request=request, outcome="password_updated")
    return {"message": "Password updated. Please log in."}


@router.post("/logout", summary="Invalidate current session token")
def logout(request: Request, user=Depends(current_user), authorization: str | None = Header(default=None)):
    token = authorization.split(" ", 1)[-1].strip() if authorization else ""
    p = _p()
    with get_conn() as conn:
        if token:
            conn.execute(f"DELETE FROM sessions WHERE token={p}", (token,))
        conn.execute(f"UPDATE refresh_tokens SET revoked=1 WHERE user_id={p}", (user["id"],))
        conn.commit()
    _audit("logout", email=str(user.get("email", "")), user_id=str(user.get("id", "")), request=request, outcome="success")
    return {"message": "Logged out successfully"}


@router.get("/me", summary="Get current user profile")
def me(user=Depends(current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "onboarding_completed": bool(user.get("onboarding_completed", 0))}
