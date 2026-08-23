"""Tool system for agents.

Each tool lives in its own module and implements the :class:`Tool` interface
(``name`` / ``description`` / ``input_schema`` / async ``execute``). The
``registry`` maps tool names to instances and filters them by an agent's
``allowed_tools`` list. Tool specs are shaped for Claude's native tool-use
format (``input_schema`` is a JSON Schema object).
"""

from app.services.tools.base import Tool
from app.services.tools import registry

__all__ = ["Tool", "registry"]
