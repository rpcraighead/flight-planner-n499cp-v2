#!/usr/bin/env python3
"""Owner CLI for product keys.

    ./issue_key.py issue ron@example.com --tier pro --expires 365 --send
    ./issue_key.py list
    ./issue_key.py revoke FP-XXXX-XXXX-XXXX-XXXX --reason "refunded"

Run with GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key, or
from a machine already authenticated with `gcloud auth application-default login`.
"""
import argparse
import os
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import firebase_admin
from firebase_admin import credentials, firestore

import licensing

APP_URL = os.environ.get('APP_URL', 'https://flightplanner.rpc-cyberflight.com')

EMAIL_BODY = """\
You've been given access to the N499CP Flight Planner.

    Product key:  {key}

To get started:

  1. Go to {url}/login
  2. Sign in with Google, Microsoft, or create a password account.
     Use this email address ({email}) -- the key is tied to it.
  3. Paste the product key when prompted.

Password accounts also set up an authenticator app for two-factor.
Keep this key somewhere safe; it can't be shown again.

-- N499CP Flight Planner, CAP San Diego Sr. Sq. 57
"""


def db():
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.ApplicationDefault())
    return firestore.client()


def send_email(to, key):
    """Send the key over SMTP. Requires SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM."""
    host = os.environ.get('SMTP_HOST')
    if not host:
        print('SMTP_HOST not set — skipping send.', file=sys.stderr)
        return False

    msg = EmailMessage()
    msg['Subject'] = 'Your N499CP Flight Planner product key'
    msg['From'] = os.environ.get('SMTP_FROM', os.environ.get('SMTP_USER', ''))
    msg['To'] = to
    msg.set_content(EMAIL_BODY.format(key=key, url=APP_URL, email=to))

    with smtplib.SMTP(host, int(os.environ.get('SMTP_PORT', 587))) as s:
        s.starttls()
        if os.environ.get('SMTP_USER'):
            s.login(os.environ['SMTP_USER'], os.environ['SMTP_PASS'])
        s.send_message(msg)
    return True


def cmd_issue(args):
    expires = (datetime.now(timezone.utc) + timedelta(days=args.expires)) \
        if args.expires else None
    key = licensing.issue(db(), args.email, tier=args.tier,
                          max_activations=args.seats, expires_at=expires,
                          notes=args.notes or '')

    print(f'\n  Key:     {key}')
    print(f'  Issued:  {args.email}')
    print(f'  Tier:    {args.tier}   Seats: {args.seats}')
    print(f'  Expires: {expires.date() if expires else "never"}')
    print('\n  Only the hash is stored — this is the one time it is shown.\n')

    if args.send and send_email(args.email, key):
        print(f'  Emailed to {args.email}.\n')


def cmd_list(args):
    rows = db().collection(licensing.COL_KEYS).stream()
    print(f'{"PREFIX":<8} {"EMAIL":<32} {"TIER":<10} {"USED":<6} STATUS')
    for r in rows:
        k = r.to_dict()
        if k.get('revoked_at'):
            status = 'revoked'
        elif k.get('expires_at') and k['expires_at'] < datetime.now(timezone.utc):
            status = 'expired'
        elif k['activations_used'] >= k['max_activations']:
            status = 'used up'
        else:
            status = 'active'
        used = f"{k['activations_used']}/{k['max_activations']}"
        print(f"{k['key_prefix']:<8} {k['issued_to_email']:<32} "
              f"{k['tier']:<10} {used:<6} {status}")


def cmd_revoke(args):
    n = licensing.revoke(db(), args.key, reason=args.reason)
    print(f'Revoked. {n} active session(s) terminated.')


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)

    i = sub.add_parser('issue', help='generate a key for an email address')
    i.add_argument('email')
    i.add_argument('--tier', default='standard')
    i.add_argument('--seats', type=int, default=1, help='max activations')
    i.add_argument('--expires', type=int, metavar='DAYS', help='expire after N days')
    i.add_argument('--notes', help='free-text note stored with the key')
    i.add_argument('--send', action='store_true', help='email the key (needs SMTP_*)')
    i.set_defaults(func=cmd_issue)

    l = sub.add_parser('list', help='list issued keys')
    l.set_defaults(func=cmd_list)

    r = sub.add_parser('revoke', help='revoke a key and kill its sessions')
    r.add_argument('key', help='full key or its sha256 hash')
    r.add_argument('--reason', default='revoked by owner')
    r.set_defaults(func=cmd_revoke)

    args = p.parse_args()
    try:
        args.func(args)
    except licensing.LicenseError as e:
        sys.exit(f'error: {e.reason}')


if __name__ == '__main__':
    main()
