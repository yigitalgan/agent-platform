"""ChromaDB vector store for RAG.

One persistent Chroma collection per knowledge base (named ``kb_{id}``), stored
under ``settings.CHROMA_DIR`` (``/data/chroma`` in Docker, on the named volume).
We embed with our own sentence-transformers service and pass vectors to Chroma
explicitly, so Chroma never falls back to downloading its default ONNX model.
"""

import logging

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

from app.core.config import settings
from app.services.rag import embedding

# chromadb 0.5.x emits a noisy "Failed to send telemetry event" line from a
# buggy posthog capture() call even with telemetry disabled. Silence its logger
# subtree so it doesn't spam the backend logs (the send is a harmless no-op).
logging.getLogger("chromadb.telemetry").setLevel(logging.CRITICAL)

_client = None


class _STEmbeddingFunction(EmbeddingFunction):
    """Chroma embedding function delegating to our sentence-transformers service.

    Attached to every collection purely to stop Chroma from constructing its
    default (ONNX) embedding function. In practice we pass embeddings/vectors
    explicitly on both add and query, so this is a safety guard.
    """

    def __call__(self, input: Documents) -> Embeddings:
        return embedding.embed(list(input))


_EMBEDDING_FUNCTION = _STEmbeddingFunction()


def _get_client():
    global _client
    if _client is None:
        # anonymized_telemetry off: avoids noisy (and currently buggy) telemetry
        # log lines and any outbound calls.
        _client = chromadb.PersistentClient(
            path=settings.CHROMA_DIR,
            settings=chromadb.Settings(anonymized_telemetry=False),
        )
    return _client


def _collection_name(kb_id: int) -> str:
    return f"kb_{kb_id}"


def _get_collection(kb_id: int):
    return _get_client().get_or_create_collection(
        name=_collection_name(kb_id),
        embedding_function=_EMBEDDING_FUNCTION,
        metadata={"hnsw:space": "cosine"},
    )


def add_documents(
    kb_id: int,
    document_id: int,
    chunks: list[str],
) -> int:
    """Embed and store ``chunks`` for a document in the KB's collection.

    Chunk ids are namespaced by document id (``doc{document_id}_chunk{i}``) so a
    document's chunks can be identified. Returns the number of chunks stored.
    """
    if not chunks:
        return 0
    collection = _get_collection(kb_id)
    ids = [f"doc{document_id}_chunk{i}" for i in range(len(chunks))]
    metadatas = [{"document_id": document_id, "chunk_index": i} for i in range(len(chunks))]
    embeddings = embedding.embed(chunks)
    collection.add(
        ids=ids,
        documents=chunks,
        metadatas=metadatas,
        embeddings=embeddings,
    )
    return len(chunks)


def query(kb_id: int, query_text: str, top_k: int = 4) -> list[str]:
    """Return the ``top_k`` most similar chunk texts for ``query_text``."""
    collection = _get_collection(kb_id)
    if collection.count() == 0:
        return []
    query_embedding = embedding.embed([query_text])[0]
    result = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
    )
    documents = result.get("documents") or [[]]
    return documents[0]


def delete_collection(kb_id: int) -> None:
    """Drop a knowledge base's collection (idempotent)."""
    try:
        _get_client().delete_collection(name=_collection_name(kb_id))
    except Exception:  # noqa: BLE001 — already-absent collection is fine
        pass
