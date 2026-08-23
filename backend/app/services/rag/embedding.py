"""Local embedding service (sentence-transformers, no API key).

Wraps ``all-MiniLM-L6-v2`` — a small, fast, open-source model producing
384-dim embeddings. The model is loaded lazily on first use and cached for the
process lifetime (loading takes a few seconds and, on a cold container, may
download ~90 MB into HF_HOME). Loading is guarded by a lock so concurrent first
requests don't each load a copy.
"""

import threading

MODEL_NAME = "all-MiniLM-L6-v2"

_model = None
_lock = threading.Lock()


def _get_model():
    """Return the cached SentenceTransformer, loading it on first call."""
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                # Imported lazily so app startup doesn't pay the import cost
                # (torch etc.) unless embeddings are actually used.
                from sentence_transformers import SentenceTransformer

                _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts into a list of float vectors."""
    if not texts:
        return []
    model = _get_model()
    vectors = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    return vectors.tolist()
