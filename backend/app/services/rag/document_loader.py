"""Extract plain text from uploaded documents (.txt / .pdf)."""

import io

SUPPORTED_EXTENSIONS = ("txt", "pdf")


class UnsupportedFormatError(ValueError):
    """Raised when a file's extension isn't a supported document format."""


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def extract_text(filename: str, data: bytes) -> str:
    """Return the plain text of an uploaded file by extension.

    Raises :class:`UnsupportedFormatError` for anything other than .txt/.pdf.
    """
    ext = _extension(filename)
    if ext == "txt":
        return data.decode("utf-8", errors="replace")
    if ext == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "") for page in reader.pages]
        return "\n".join(pages)
    raise UnsupportedFormatError(
        f"Desteklenmeyen dosya formatı: .{ext or '?'}. "
        f"Yalnızca {', '.join('.' + e for e in SUPPORTED_EXTENSIONS)} desteklenir."
    )
