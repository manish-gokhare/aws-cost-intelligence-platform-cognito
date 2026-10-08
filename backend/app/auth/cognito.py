import os
import ssl
from typing import Any

from dotenv import load_dotenv

load_dotenv()

import certifi
import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient


# ---------------------------------------------------------------------------
# Cognito configuration
# ---------------------------------------------------------------------------

COGNITO_REGION = os.getenv(
    "COGNITO_REGION",
    "us-east-1",
)

COGNITO_USER_POOL_ID = os.getenv(
    "COGNITO_USER_POOL_ID",
)

COGNITO_APP_CLIENT_ID = os.getenv(
    "COGNITO_APP_CLIENT_ID",
)

ALLOWED_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ALLOWED_EMAILS", "").split(",")
    if email.strip()
}


# ---------------------------------------------------------------------------
# Cognito endpoints
# ---------------------------------------------------------------------------

COGNITO_ISSUER = (
    f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/"
    f"{COGNITO_USER_POOL_ID}"
)

COGNITO_JWKS_URL = (
    f"{COGNITO_ISSUER}/.well-known/jwks.json"
)


# ---------------------------------------------------------------------------
# SSL configuration
# ---------------------------------------------------------------------------
#
# certifi provides a CA bundle that allows Python to securely connect
# to the Cognito JWKS endpoint on the local development machine.
#

ssl_context = ssl.create_default_context(
    cafile=certifi.where()
)


# ---------------------------------------------------------------------------
# Authentication configuration
# ---------------------------------------------------------------------------

bearer_scheme = HTTPBearer(
    auto_error=False
)


jwks_client = PyJWKClient(
    COGNITO_JWKS_URL,
    ssl_context=ssl_context,
)


# ---------------------------------------------------------------------------
# Helper: Cognito signing key
# ---------------------------------------------------------------------------

def _get_signing_key(token: str):
    """
    Retrieve the Cognito public signing key used to verify the JWT.
    """

    return (
        jwks_client
        .get_signing_key_from_jwt(token)
        .key
    )


# ---------------------------------------------------------------------------
# Access-token validation
# ---------------------------------------------------------------------------

def verify_cognito_access_token(
    token: str,
) -> dict[str, Any]:
    """
    Validate a Cognito ACCESS token.

    Checks:

    - JWT signature
    - token expiration
    - issuer
    - token_use
    - Cognito application client ID
    """

    try:
        signing_key = _get_signing_key(token)

        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=COGNITO_ISSUER,
            options={
                "require": [
                    "exp",
                    "iat",
                    "iss",
                    "token_use",
                    "client_id",
                ],
                # Cognito access tokens use client_id rather
                # than the ID-token audience claim.
                "verify_aud": False,
            },
        )

    except Exception as exc:
        print(
            "Cognito access token validation failed: "
            f"{type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        ) from exc

    # Make sure this is an ACCESS token.
    if payload.get("token_use") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

    # Make sure the token belongs to our Cognito application.
    if payload.get("client_id") != COGNITO_APP_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token was issued for an unexpected client.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

    return payload


# ---------------------------------------------------------------------------
# ID-token validation
# ---------------------------------------------------------------------------

def verify_cognito_id_token(
    token: str,
) -> dict[str, Any]:
    """
    Validate a Cognito ID token.

    The ID token provides trusted user identity information,
    including the user's email address.

    Checks:

    - JWT signature
    - token expiration
    - issuer
    - audience
    - token_use
    - email claim
    """

    try:
        signing_key = _get_signing_key(token)

        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=COGNITO_ISSUER,
            audience=COGNITO_APP_CLIENT_ID,
            options={
                "require": [
                    "exp",
                    "iat",
                    "iss",
                    "aud",
                    "token_use",
                    "email",
                ],
            },
        )

    except Exception as exc:
        print(
            "Cognito ID token validation failed: "
            f"{type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired identity token.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        ) from exc

    # Make sure this is an ID token.
    if payload.get("token_use") != "id":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid identity token type.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

    return payload


# ---------------------------------------------------------------------------
# Current authenticated user
# ---------------------------------------------------------------------------

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_scheme
    ),
) -> dict[str, Any]:
    """
    Extract and validate the Cognito ACCESS token from:

        Authorization: Bearer <access-token>
    """

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

    if credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer authentication required.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

    return verify_cognito_access_token(
        credentials.credentials
    )


# ---------------------------------------------------------------------------
# Authorized application user
# ---------------------------------------------------------------------------

def get_allowed_user(
    user: dict[str, Any] = Depends(get_current_user),
    id_token: str | None = Header(
        default=None,
        alias="X-ID-Token",
    ),
) -> dict[str, Any]:
    """
    Authenticate the API request with the Cognito ACCESS token
    and authorize the user using the validated Cognito ID token.

    Request must contain:

        Authorization: Bearer <access-token>
        X-ID-Token: <id-token>
    """

    # -----------------------------------------------------------------------
    # Make sure the frontend sent the ID token.
    # -----------------------------------------------------------------------

    if not id_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identity token required.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

    # -----------------------------------------------------------------------
    # Validate the ID token.
    # -----------------------------------------------------------------------

    identity = verify_cognito_id_token(
        id_token
    )

    # -----------------------------------------------------------------------
    # TEMPORARY SAFE DEBUGGING
    #
    # We intentionally DO NOT print either JWT.
    # We only print non-sensitive identity information so we can determine
    # why authorization is currently returning 403.
    # -----------------------------------------------------------------------

    print(
        "Cognito identity:",
        {
            "email": identity.get("email"),
            "email_verified": identity.get("email_verified"),
            "token_use": identity.get("token_use"),
            "aud": identity.get("aud"),
        },
    )

    print(
        "Allowed emails:",
        sorted(ALLOWED_EMAILS),
    )

    # -----------------------------------------------------------------------
    # Get email from the validated ID token.
    # -----------------------------------------------------------------------

    email = identity.get("email")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated user does not have an email address.",
        )

    normalized_email = email.strip().lower()

    # -----------------------------------------------------------------------
    # Require verified email.
    # -----------------------------------------------------------------------

    if identity.get("email_verified") is not True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User email address is not verified.",
        )

    # -----------------------------------------------------------------------
    # Check application allowlist.
    # -----------------------------------------------------------------------

    if normalized_email not in ALLOWED_EMAILS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not authorized to access this application.",
        )

    # -----------------------------------------------------------------------
    # Return trusted user information.
    # -----------------------------------------------------------------------

    return {
        "email": normalized_email,
        "username": identity.get("cognito:username"),
        "sub": identity.get("sub"),
    }
