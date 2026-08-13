"""Identity Platform authentication and the entitlement gate.

Sign-in happens in the browser (FirebaseUI), which hands us a short-lived ID
token. We exchange that once for an HttpOnly session cookie and authorize every
later request from the cookie alone -- no token refresh logic in the page, and
nothing readable by JavaScript.

Authorization has two independent conditions, both carried in the cookie:
  * a valid, unrevoked session          -> you are who you say you are
  * a 'lic' custom claim                -> you redeemed a product key
Password users additionally need a TOTP second factor; federated users are
already covered by their provider's own MFA.
"""
import os
from datetime import timedelta

import firebase_admin
from firebase_admin import auth, credentials, firestore
from flask import (Blueprint, current_app, g, jsonify, redirect, render_template,
                   request, url_for)

import licensing

bp = Blueprint('auth', __name__)

COOKIE = '__session'
SESSION_DAYS = 5
# A session cookie is long-lived, so only mint one from a genuinely fresh login.
MAX_AUTH_AGE = timedelta(minutes=5)

# Reachable without a session. Everything else requires one.
PUBLIC_PATHS = {
    '/login', '/activate', '/enroll-mfa',
    '/sessionLogin', '/sessionLogout', '/healthz',
}
PUBLIC_PREFIXES = ('/static/', '/__/')

_db = None


def init_app(app):
    """Initialize Firebase, register routes, and install the gate."""
    global _db
    if not firebase_admin._apps:
        # On Cloud Run the runtime service account is picked up automatically;
        # locally, point GOOGLE_APPLICATION_CREDENTIALS at a service account key.
        firebase_admin.initialize_app(credentials.ApplicationDefault())
    _db = firestore.client()

    app.register_blueprint(bp)
    app.before_request(require_entitlement)
    return app


def db():
    return _db


def _wants_json():
    return request.path.startswith('/api/') or \
        request.accept_mimetypes.best == 'application/json'


def _deny(where, **params):
    """Bounce to a page, or 401 for API callers so fetch() doesn't get HTML."""
    if _wants_json():
        return jsonify(error=where.lstrip('/')), 401
    return redirect(url_for(f'auth.{where}', **params))


def current_user():
    """Decoded session cookie for this request, or None."""
    return getattr(g, 'user', None)


def require_entitlement():
    """Gate every request that is not explicitly public."""
    path = request.path
    if path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES):
        return None

    cookie = request.cookies.get(COOKIE)
    if not cookie:
        return _deny('login')

    try:
        # check_revoked hits the Auth backend so that revoking a key actually
        # ends live sessions instead of waiting for the cookie to expire.
        user = auth.verify_session_cookie(cookie, check_revoked=True)
    except Exception:
        return _deny('login')

    g.user = user

    fb = user.get('firebase', {})
    if fb.get('sign_in_provider') == 'password' and not fb.get('sign_in_second_factor'):
        return _deny('enroll_mfa')
    if not user.get('lic'):
        return _deny('activate')
    return None


@bp.get('/healthz')
def healthz():
    return 'ok', 200


@bp.get('/login')
def login():
    return render_template('login.html', **_client_config())


@bp.get('/enroll-mfa')
def enroll_mfa():
    return render_template('enroll_mfa.html', **_client_config())


@bp.post('/sessionLogin')
def session_login():
    """Exchange a freshly minted ID token for a session cookie."""
    token = (request.json or {}).get('idToken', '')
    try:
        decoded = auth.verify_id_token(token, check_revoked=True)
    except Exception:
        return jsonify(error='invalid token'), 401

    import time
    if time.time() - decoded['auth_time'] > MAX_AUTH_AGE.total_seconds():
        return jsonify(error='reauth required'), 401
    if not decoded.get('email_verified'):
        return jsonify(error='email not verified'), 403

    cookie = auth.create_session_cookie(token, expires_in=timedelta(days=SESSION_DAYS))
    resp = jsonify(licensed=bool(decoded.get('lic')))
    resp.set_cookie(COOKIE, cookie,
                    max_age=int(timedelta(days=SESSION_DAYS).total_seconds()),
                    httponly=True, secure=_secure_cookies(), samesite='Lax')
    return resp


@bp.post('/sessionLogout')
def session_logout():
    cookie = request.cookies.get(COOKIE)
    if cookie:
        try:
            auth.revoke_refresh_tokens(auth.verify_session_cookie(cookie)['sub'])
        except Exception:
            pass
    resp = jsonify(status='ok')
    resp.delete_cookie(COOKIE)
    return resp


@bp.route('/activate', methods=['GET', 'POST'])
def activate():
    """Redeem a product key against the signed-in identity."""
    cookie = request.cookies.get(COOKIE)
    try:
        user = auth.verify_session_cookie(cookie, check_revoked=True) if cookie else None
    except Exception:
        user = None

    if not user:
        return redirect(url_for('auth.login'))
    if request.method == 'GET':
        return render_template('activate.html', email=user.get('email'),
                               **_client_config())

    if not user.get('email_verified'):
        return jsonify(error='Verify your email address before activating.'), 403

    key = (request.json or {}).get('key', '')
    if not key.strip():
        return jsonify(error='Enter your product key.'), 400

    try:
        licensing.activate(_db, key, user['sub'], user['email'],
                           ip=request.headers.get('X-Forwarded-For', request.remote_addr),
                           user_agent=request.headers.get('User-Agent'))
    except licensing.LicenseError as e:
        # Log the specific reason; tell the user only that it did not work.
        current_app.logger.warning('activation refused for %s: %s', user['email'], e.reason)
        return jsonify(error="That key isn't valid for this account."), 400

    # The claim was just set, so the current cookie predates it. The client must
    # force-refresh its ID token and call /sessionLogin again to pick it up.
    return jsonify(status='ok', refresh=True)


def _secure_cookies():
    return os.environ.get('FLASK_ENV') != 'development'


def _client_config():
    """Public Firebase web config -- safe to embed, these are not secrets."""
    return {
        'api_key': os.environ.get('FIREBASE_API_KEY', ''),
        'auth_domain': os.environ.get('FIREBASE_AUTH_DOMAIN', ''),
        'project_id': os.environ.get('GOOGLE_CLOUD_PROJECT', ''),
        # Microsoft appears automatically once its provider is configured.
        'providers': [p for p in os.environ.get(
            'AUTH_PROVIDERS', 'google.com,password').split(',') if p],
    }
