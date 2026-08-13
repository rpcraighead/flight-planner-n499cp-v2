"""Product key issuance and activation, backed by Firestore.

Keys are high-entropy random values, so only a SHA-256 digest is stored -- there
is nothing to brute force, and a digest makes lookup a single indexed get()
instead of a query. The plaintext key is shown exactly once, at issuance.

Entitlement is mirrored into a Firebase custom claim ('lic') at activation time
so the request path can authorize from the session cookie alone, with no
Firestore read per request. Firestore remains the source of truth; the claim is
a cache that is refreshed whenever the client mints a new ID token.
"""
import hashlib
import secrets
from datetime import datetime, timezone

from firebase_admin import auth, firestore

# Crockford base32 -- I, L, O and U are omitted so keys survive being read aloud,
# handwritten, or retyped from a phone screen.
ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
KEY_BYTES = 10          # 80 bits of entropy -> 16 characters
PREFIX = 'FP'

COL_KEYS = 'license_keys'
COL_USERS = 'users'
COL_ACTIVATIONS = 'activations'


class LicenseError(Exception):
    """Activation refused. `.reason` is for logs; the user gets a generic message."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def new_key():
    """Generate a fresh product key in FP-XXXX-XXXX-XXXX-XXXX form."""
    n = int.from_bytes(secrets.token_bytes(KEY_BYTES), 'big')
    body = ''.join(ALPHABET[(n >> (5 * i)) & 31] for i in range(16))[::-1]
    return PREFIX + '-' + '-'.join(body[i:i + 4] for i in range(0, 16, 4))


def normalize(key):
    """Strip formatting and fold the characters Crockford treats as ambiguous."""
    k = key.upper().strip().replace('-', '').replace(' ', '')
    # Length-check the prefix rather than removeprefix(): 'F' and 'P' are both in
    # the alphabet, so a bare 16-char body can legitimately start with "FP".
    if len(k) == len(PREFIX) + 16 and k.startswith(PREFIX):
        k = k[len(PREFIX):]
    return k.translate(str.maketrans('ILO', '110'))


def key_hash(key):
    return hashlib.sha256(normalize(key).encode()).hexdigest()


def key_prefix(key):
    """First group of a key, kept in plaintext so you can identify it in support."""
    return normalize(key)[:4]


def issue(db, email, tier='standard', max_activations=1, expires_at=None, notes=''):
    """Create a key for `email`. Returns the plaintext key -- store it now or lose it."""
    key = new_key()
    db.collection(COL_KEYS).document(key_hash(key)).set({
        'key_prefix': key_prefix(key),
        'issued_to_email': email.lower().strip(),
        'email_locked': True,
        'tier': tier,
        'max_activations': max_activations,
        'activations_used': 0,
        'expires_at': expires_at,
        'revoked_at': None,
        'revoked_reason': None,
        'created_at': datetime.now(timezone.utc),
        'notes': notes,
    })
    return key


def activate(db, key, uid, email, ip=None, user_agent=None):
    """Consume one activation of `key` for the signed-in user `uid`.

    Runs as a Firestore transaction so two people racing the same single-seat key
    cannot both get in. Sets the 'lic' custom claim on success; the caller must
    have the client refresh its ID token before exchanging it for a session cookie,
    or the new claim will not be present.
    """
    email = email.lower().strip()
    key_ref = db.collection(COL_KEYS).document(key_hash(key))
    transaction = db.transaction()
    lic = _consume(transaction, key_ref, uid, email, ip, user_agent, db)

    auth.set_custom_user_claims(uid, {'lic': {
        'tier': lic['tier'],
        'key_prefix': lic['key_prefix'],
    }})
    return lic


@firestore.transactional
def _consume(transaction, key_ref, uid, email, ip, user_agent, db):
    snap = key_ref.get(transaction=transaction)
    if not snap.exists:
        raise LicenseError('no such key')

    k = snap.to_dict()
    now = datetime.now(timezone.utc)

    if k.get('revoked_at'):
        raise LicenseError('key revoked')
    if k.get('expires_at') and k['expires_at'] < now:
        raise LicenseError('key expired')
    if k['activations_used'] >= k['max_activations']:
        raise LicenseError('no activations remaining')
    # An unverified email would let anyone claim a key issued to someone else.
    if k.get('email_locked') and k['issued_to_email'] != email:
        raise LicenseError(f"email mismatch: issued to {k['issued_to_email']}, got {email}")

    transaction.update(key_ref, {'activations_used': k['activations_used'] + 1})
    transaction.set(db.collection(COL_USERS).document(uid), {
        'email': email,
        'tier': k['tier'],
        'key_hash': key_ref.id,
        'key_prefix': k['key_prefix'],
        'status': 'active',
        'activated_at': now,
    }, merge=True)
    transaction.set(db.collection(COL_ACTIVATIONS).document(), {
        'key_hash': key_ref.id,
        'uid': uid,
        'email': email,
        'activated_at': now,
        'ip': ip,
        'user_agent': user_agent,
    })
    return {'tier': k['tier'], 'key_prefix': k['key_prefix']}


def revoke(db, key_or_hash, reason='revoked by owner'):
    """Revoke a key and kill every session that was activated with it.

    revoke_refresh_tokens() is what actually ends existing sessions -- clearing the
    claim alone would leave already-issued cookies valid until they expire.
    """
    h = key_or_hash if len(key_or_hash) == 64 else key_hash(key_or_hash)
    key_ref = db.collection(COL_KEYS).document(h)
    if not key_ref.get().exists:
        raise LicenseError('no such key')

    key_ref.update({
        'revoked_at': datetime.now(timezone.utc),
        'revoked_reason': reason,
    })

    revoked = 0
    for user in db.collection(COL_USERS).where('key_hash', '==', h).stream():
        db.collection(COL_USERS).document(user.id).update({'status': 'revoked'})
        try:
            auth.set_custom_user_claims(user.id, {})
            auth.revoke_refresh_tokens(user.id)
            revoked += 1
        except auth.UserNotFoundError:
            pass
    return revoked
