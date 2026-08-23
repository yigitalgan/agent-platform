"""Shared rate limiter (slowapi).

Defined here so both ``main`` (to register the handler) and the route modules
(to decorate endpoints) import the same ``Limiter`` instance. Applied to the
streaming endpoints, which are the ones that spend LLM credits.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

# Per-IP limit for the cost-bearing streaming endpoints. Tune as needed.
STREAM_RATE_LIMIT = "20/minute"
