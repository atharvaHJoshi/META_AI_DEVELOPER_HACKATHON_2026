"""Auth routes — login, refresh-token rotation, sessions, OAuth (Meta)."""

from __future__ import annotations

from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, Body, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse

from core import config
from core.errors import ApiError
from core.security import (
    refresh_cookie_options,
    sign_oauth_state,
    verify_oauth_state,
)
from api.deps import current_user, optional_current_user
from api.schemas import (
    DemoLoginInput,
    ForgotPasswordInput,
    LoginInput,
    ProfileInput,
    RegisterInput,
    ResetPasswordInput,
    StrictModel,
)
from services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def config_cookie_name() -> str:
    return "mw_refresh"


class RefreshBody(StrictModel):
    refreshToken: str | None = None


def _set_refresh_cookie(response: Response, token: str) -> None:
    options = refresh_cookie_options()
    response.set_cookie(
        config_cookie_name(),
        token,
        httponly=options["httponly"],
        secure=options["secure"],
        samesite=options["samesite"],
        path=options["path"],
        max_age=options["max_age"],
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(config_cookie_name(), path="/")


def _meta(request: Request) -> dict:
    return auth_service.request_meta(request)


def _refresh_token(request: Request, body: dict | None) -> str | None:
    if body:
        token = body.get("refreshToken")
        if isinstance(token, str) and token:
            return token
    cookie = request.cookies.get(config_cookie_name())
    return cookie or None


@router.post("/register", status_code=201)
def register(payload: RegisterInput, request: Request, response: Response):
    result = auth_service.register(payload.model_dump(), _meta(request))
    _set_refresh_cookie(response, result["refreshToken"])
    return _auth_payload(result)


@router.post("/login")
def login(payload: LoginInput, request: Request, response: Response):
    result = auth_service.login(payload.model_dump(), _meta(request))
    _set_refresh_cookie(response, result["refreshToken"])
    return _auth_payload(result)


@router.post("/demo")
def demo_login(payload: DemoLoginInput, request: Request, response: Response):
    result = auth_service.demo_login(payload.email, _meta(request))
    _set_refresh_cookie(response, result["refreshToken"])
    return _auth_payload(result)


@router.post("/refresh")
def refresh(request: Request, response: Response, payload: RefreshBody | None = Body(None)):
    body = payload.model_dump() if payload else {}
    token = _refresh_token(request, body)
    if not token:
        raise ApiError(401, "NO_REFRESH_TOKEN", "No refresh token was supplied.")
    result = auth_service.rotate_refresh_token(token, _meta(request))
    _set_refresh_cookie(response, result["refreshToken"])
    return _auth_payload(result)


@router.post("/logout")
def logout(request: Request, response: Response, payload: RefreshBody | None = Body(None)):
    body = payload.model_dump() if payload else {}
    token = _refresh_token(request, body)
    user = optional_current_user(request)
    if token:
        auth_service.revoke_refresh_token(token, user["id"] if user else None)
    _clear_refresh_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return auth_service.current_user(user["id"])


@router.patch("/profile")
def update_profile(
    payload: ProfileInput,
    user: dict = Depends(current_user),
):
    data = {key: value for key, value in payload.model_dump().items() if value is not None}
    auth_service.update_profile(user["id"], data)
    return auth_service.current_user(user["id"])


@router.get("/sessions")
def list_sessions(request: Request, user: dict = Depends(current_user)):
    return {"sessions": auth_service.list_sessions(user["id"], _refresh_token(request, None))}


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: str, user: dict = Depends(current_user)):
    auth_service.revoke_session(user["id"], session_id)
    return {"ok": True}


@router.post("/password/forgot")
def forgot_password(payload: ForgotPasswordInput, request: Request):
    result = auth_service.forgot_password(payload.email, _meta(request))
    return {
        "ok": True,
        "message": "If an account exists, a reset link has been issued.",
        "devToken": result["devToken"],
    }


@router.post("/password/reset")
def reset_password(payload: ResetPasswordInput, request: Request):
    auth_service.reset_password(payload.token, payload.password, _meta(request))
    return {"ok": True}


@router.get("/oauth/status")
def oauth_status():
    return {
        "meta": {
            "configured": bool(config.META_OAUTH["appId"] and config.META_OAUTH["appSecret"]),
            "label": "Continue with Meta",
            "redirectUri": config.META_OAUTH["redirectUri"],
        }
    }


@router.get("/oauth/meta/start")
def oauth_meta_start(
    request: Request,
    returnTo: str = Query(default="/"),
):
    if not config.META_OAUTH["appId"] or not config.META_OAUTH["appSecret"]:
        raise ApiError(
            503,
            "META_OAUTH_NOT_CONFIGURED",
            "Meta OAuth is not configured. Set META_APP_ID and META_APP_SECRET on the server.",
        )
    requested = returnTo if isinstance(returnTo, str) else "/"
    target = requested if requested.startswith("/") and not requested.startswith("//") else "/"
    state = sign_oauth_state(target)
    params = {
        "client_id": config.META_OAUTH["appId"],
        "redirect_uri": config.META_OAUTH["redirectUri"],
        "state": state,
        "response_type": "code",
        "scope": "email,public_profile",
    }
    url = f"https://www.facebook.com/{config.META_OAUTH['graphVersion']}/dialog/oauth?{urlencode(params)}"
    return RedirectResponse(url)


@router.get("/oauth/meta/callback")
def oauth_meta_callback(
    request: Request,
    state: str = Query(default=""),
    code: str = Query(default=""),
    error: str = Query(default=""),
    error_description: str = Query(default=""),
):
    verified = verify_oauth_state(state)
    web_origin = config.WEB_ORIGIN

    def redirect_error(message: str) -> RedirectResponse:
        return RedirectResponse(f"{web_origin}/login?oauth_error={quote(message)}")

    if not verified:
        return redirect_error("Invalid OAuth state.")
    error_message = error_description or error
    if error_message or not code:
        return redirect_error(error_message or "Meta sign-in was cancelled.")
    if not config.META_OAUTH["appId"] or not config.META_OAUTH["appSecret"]:
        return redirect_error("Meta OAuth is not configured.")

    try:
        token_url = (
            f"https://graph.facebook.com/{config.META_OAUTH['graphVersion']}/oauth/access_token?"
            + urlencode(
                {
                    "client_id": config.META_OAUTH["appId"],
                    "client_secret": config.META_OAUTH["appSecret"],
                    "redirect_uri": config.META_OAUTH["redirectUri"],
                    "code": code,
                }
            )
        )
        with httpx.Client(timeout=15.0) as client:
            token_response = client.get(token_url)
            if token_response.status_code >= 400:
                raise RuntimeError(f"Meta token exchange failed (HTTP {token_response.status_code}).")
            token_payload = token_response.json()
            access_token = token_payload.get("access_token")
            if not access_token:
                raise RuntimeError("Meta did not return an access token.")
            profile_url = (
                f"https://graph.facebook.com/{config.META_OAUTH['graphVersion']}/me?"
                + urlencode({"fields": "id,name,email,picture", "access_token": access_token})
            )
            profile_response = client.get(profile_url)
            if profile_response.status_code >= 400:
                raise RuntimeError(f"Meta profile request failed (HTTP {profile_response.status_code}).")
            profile = profile_response.json()
    except Exception as exc:  # noqa: BLE001
        return redirect_error(str(exc) or "Meta sign-in failed.")

    provider_user_id = profile.get("id")
    if not provider_user_id:
        return redirect_error("Meta profile did not include a user id.")

    result = auth_service.login_with_oauth(
        "meta",
        {
            "providerUserId": str(provider_user_id),
            "email": profile.get("email"),
            "name": profile.get("name") or "Meta member",
        },
        _meta(request),
    )
    target = f"{web_origin}/auth/callback"
    response = RedirectResponse(f"{target}?returnTo={quote(verified['returnTo'])}")
    response.set_cookie(
        config_cookie_name(),
        result["refreshToken"],
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
        path="/",
        max_age=config.REFRESH_TOKEN_DAYS * 24 * 60 * 60,
    )
    return response


def _auth_payload(result: dict) -> dict:
    return {
        "user": result["user"],
        "accessToken": result["accessToken"],
        "refreshToken": result["refreshToken"],
        "expiresIn": result["expiresIn"],
        "organizations": result["organizations"],
        "workspaces": result["workspaces"],
    }
