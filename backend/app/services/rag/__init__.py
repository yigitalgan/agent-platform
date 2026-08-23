"""Retrieval-Augmented Generation (RAG) services.

Splits uploaded documents into overlapping chunks (``chunking``), embeds them
with a local sentence-transformers model (``embedding``), and stores/queries
them in a persistent ChromaDB index keyed by knowledge base (``vector_store``).
``document_loader`` extracts plain text from uploaded .txt/.pdf files.
"""
