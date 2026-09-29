"""
groq_client.py
Single place that talks to Groq. Every AI feature in Serenity
(AI Companion, journal analysis, insights narrative) goes through
groq_chat(), so the API key / model live in one spot.

Env vars (.env locally, Environment tab on Render):
    GROQ_API_KEY=gsk_...
    GROQ_MODEL=llama-3.3-70b-versatile   # optional override
"""
import os
from groq import Groq, APIError

DEFAULT_MODEL = "openai/gpt-oss-120b"


class AIUnavailable(Exception):
    """Raised when Groq can't be reached, is rate-limited, or the key is missing."""


_client = None


def _get_client():
    # Created lazily so load_dotenv() in app.py has already run.
    global _client
    if _client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise AIUnavailable("GROQ_API_KEY is not set")
        _client = Groq(api_key=api_key, timeout=30.0, max_retries=1)
    return _client


def groq_chat(messages, temperature=0.7, max_tokens=400, model=None):
    """messages = [{'role': 'system'|'user'|'assistant', 'content': str}, ...]
    Returns the reply text (may be ''). Raises AIUnavailable on API failure."""
    try:
        resp = _get_client().chat.completions.create(
            model=model or os.getenv("GROQ_MODEL", DEFAULT_MODEL),
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    except APIError as e:
        raise AIUnavailable(str(e)) from e
    return (resp.choices[0].message.content or "").strip()