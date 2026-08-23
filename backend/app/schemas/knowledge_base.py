from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""


class KnowledgeBaseResponse(BaseModel):
    id: int
    name: str
    description: str
    created_at: datetime
    document_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class DocumentResponse(BaseModel):
    id: int
    knowledge_base_id: int
    filename: str
    chunk_count: int
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)
