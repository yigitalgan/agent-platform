"""Tool registry.

Maps tool names to singleton instances and provides helpers to look them up,
filter by an agent's ``allowed_tools`` list, and validate tool names coming
from the API. Add a new tool by importing it and appending an instance to
``_TOOL_INSTANCES``.
"""

from app.services.tools.base import Tool
from app.services.tools.calculator import CalculatorTool
from app.services.tools.document_search import DocumentSearchTool
from app.services.tools.duckduckgo_search import DuckDuckGoSearchTool
from app.services.tools.weather import WeatherTool
from app.services.tools.web_search import WebSearchTool
from app.services.tools.wikipedia_search import WikipediaSearchTool

_TOOL_INSTANCES: list[Tool] = [
    CalculatorTool(),
    WikipediaSearchTool(),
    DuckDuckGoSearchTool(),
    DocumentSearchTool(),
    WeatherTool(),
    WebSearchTool(),
]

_REGISTRY: dict[str, Tool] = {tool.name: tool for tool in _TOOL_INSTANCES}


def all_tool_names() -> list[str]:
    """Every registered tool name."""
    return list(_REGISTRY.keys())


def get_tool(name: str) -> Tool | None:
    """Look up a tool instance by name (``None`` if unknown)."""
    return _REGISTRY.get(name)


def invalid_tool_names(names: list[str]) -> list[str]:
    """Return the subset of ``names`` that are not registered tools."""
    return [n for n in names if n not in _REGISTRY]


def tool_specs(allowed: list[str]) -> list[dict]:
    """Claude tool-use specs for the agent's allowed (and known) tools."""
    return [_REGISTRY[n].spec() for n in allowed if n in _REGISTRY]
