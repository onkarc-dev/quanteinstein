"""Tenant context management for dual-tier multi-tenant / single-tenant routing.

Uses contextvars to provide thread-safe, async-safe tenant routing for incoming requests.
Retail users default to None (shared database).
Enterprise users have their isolated tenant connection URL set for the request lifecycle.
"""
from __future__ import annotations

import contextvars
from typing import Any, Dict, Optional, Tuple

_current_tenant_db_url: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "_current_tenant_db_url", default=None
)
_current_tenant_user: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar(
    "_current_tenant_user", default=None
)


def set_current_tenant(db_url: Optional[str], user: Optional[Dict[str, Any]] = None) -> Tuple[Any, Any]:
    """Set the active tenant database URL and user context for the current execution flow."""
    token_url = _current_tenant_db_url.set(db_url)
    token_user = _current_tenant_user.set(user)
    return token_url, token_user


def get_current_tenant_url() -> Optional[str]:
    """Get the active tenant database URL if set (Enterprise), or None (Retail shared DB)."""
    return _current_tenant_db_url.get()


def get_current_tenant_user() -> Optional[Dict[str, Any]]:
    """Get the active tenant user context if set."""
    return _current_tenant_user.get()


def reset_current_tenant(tokens: Tuple[Any, Any]) -> None:
    """Reset the tenant context back to its previous state."""
    token_url, token_user = tokens
    _current_tenant_db_url.reset(token_url)
    _current_tenant_user.reset(token_user)
