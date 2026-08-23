"""Knowledge base + document management endpoints (RAG).

A knowledge base is a named collection of uploaded documents. Uploading a file
extracts its text, chunks it, embeds the chunks, and stores them in the KB's
ChromaDB collection; a Document row records the file metadata. Deleting a KB
also drops its Chroma collection.
"""

import asyncio
import logging

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.agent import Agent
from app.models.document import Document
from app.models.knowledge_base import KnowledgeBase
from app.schemas.knowledge_base import (
    DocumentResponse,
    KnowledgeBaseCreate,
    KnowledgeBaseResponse,
)
from app.services.rag import chunking, document_loader, vector_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-bases"])

# Reject uploads larger than this to bound memory/embedding cost.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


def _to_response(kb: KnowledgeBase, document_count: int) -> KnowledgeBaseResponse:
    return KnowledgeBaseResponse(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        created_at=kb.created_at,
        document_count=document_count,
    )


def _get_kb_or_404(kb_id: int, db: Session) -> KnowledgeBase:
    kb = db.get(KnowledgeBase, kb_id)
    if kb is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        )
    return kb


@router.post(
    "", response_model=KnowledgeBaseResponse, status_code=status.HTTP_201_CREATED
)
def create_knowledge_base(
    payload: KnowledgeBaseCreate, db: Session = Depends(get_db)
):
    kb = KnowledgeBase(name=payload.name, description=payload.description)
    db.add(kb)
    db.commit()
    db.refresh(kb)
    return _to_response(kb, document_count=0)


@router.get("", response_model=list[KnowledgeBaseResponse])
def list_knowledge_bases(db: Session = Depends(get_db)):
    kbs = db.scalars(
        select(KnowledgeBase).order_by(KnowledgeBase.created_at.desc())
    ).all()
    # Document counts in one grouped query, then zip onto the KBs.
    counts = dict(
        db.execute(
            select(Document.knowledge_base_id, func.count(Document.id)).group_by(
                Document.knowledge_base_id
            )
        ).all()
    )
    return [_to_response(kb, counts.get(kb.id, 0)) for kb in kbs]


@router.delete("/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge_base(kb_id: int, db: Session = Depends(get_db)):
    kb = _get_kb_or_404(kb_id, db)

    # Block deletion when an agent still references this KB — otherwise the
    # agent would point at a missing KB (orphan). Consistent with agent-delete
    # guards.
    agent_count = db.scalar(
        select(func.count())
        .select_from(Agent)
        .where(Agent.knowledge_base_id == kb_id)
    )
    if agent_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Bu bilgi tabanı {agent_count} agent tarafından kullanılıyor. "
                "Silmeden önce o agent'lardan bağlantıyı kaldırın."
            ),
        )

    # Drop the vector collection first; Document rows cascade with the KB.
    vector_store.delete_collection(kb_id)
    db.delete(kb)
    db.commit()


@router.get("/{kb_id}/documents", response_model=list[DocumentResponse])
def list_documents(kb_id: int, db: Session = Depends(get_db)):
    _get_kb_or_404(kb_id, db)
    return db.scalars(
        select(Document)
        .where(Document.knowledge_base_id == kb_id)
        .order_by(Document.uploaded_at.desc())
    ).all()


@router.post(
    "/{kb_id}/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    kb_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _get_kb_or_404(kb_id, db)

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Dosya çok büyük ({len(content) // 1024} KB). "
                f"Üst sınır {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
            ),
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Boş dosya."
        )

    # Extract text (unsupported format → 400).
    try:
        text = document_loader.extract_text(file.filename or "", content)
    except document_loader.UnsupportedFormatError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        )

    chunks = chunking.chunk_text(text)
    if not chunks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dosyadan metin çıkarılamadı (boş veya taranmış PDF olabilir).",
        )

    # Create the Document row first so chunk ids can reference its id.
    document = Document(
        knowledge_base_id=kb_id,
        filename=file.filename or "document",
        chunk_count=0,
    )
    db.add(document)
    db.flush()  # assign document.id

    # Embedding + Chroma writes are blocking; run off the event loop.
    try:
        stored = await asyncio.to_thread(
            vector_store.add_documents, kb_id, document.id, chunks
        )
    except Exception:  # noqa: BLE001 — log detail, return a generic message
        db.rollback()
        logger.exception("Document indexing failed (kb_id=%s)", kb_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Doküman indekslenirken bir hata oluştu.",
        )

    document.chunk_count = stored
    db.commit()
    db.refresh(document)
    return document
