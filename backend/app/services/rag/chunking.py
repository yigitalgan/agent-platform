"""Text chunking for RAG.

Splits text into overlapping word windows. This is deliberately simple — a
word count, not a real tokenizer — which is plenty for retrieval quality here
and avoids pulling in a heavyweight tokenizer dependency.
"""

DEFAULT_CHUNK_SIZE = 500  # words per chunk
DEFAULT_OVERLAP = 50  # words shared between consecutive chunks


def chunk_text(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
) -> list[str]:
    """Split ``text`` into overlapping chunks of ~``chunk_size`` words.

    Consecutive chunks share ``overlap`` words so context isn't lost at chunk
    boundaries. Returns an empty list for blank input.
    """
    words = text.split()
    if not words:
        return []
    if overlap >= chunk_size:
        overlap = chunk_size - 1  # guarantee forward progress
    step = chunk_size - overlap

    chunks: list[str] = []
    for start in range(0, len(words), step):
        window = words[start : start + chunk_size]
        if window:
            chunks.append(" ".join(window))
        if start + chunk_size >= len(words):
            break
    return chunks
