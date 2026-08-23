"""Common tool interface.

A tool exposes the three fields Claude's tool-use API needs — ``name``,
``description``, ``input_schema`` (a JSON Schema object) — and an async
``execute`` that runs the tool and returns a plain string result. ``execute``
should never raise for expected failures (bad input, network down); it returns
a human-readable ``"hata: ..."`` string instead so the chat loop can hand it
back to Claude as a tool_result without crashing.
"""

from abc import ABC, abstractmethod


class Tool(ABC):
    #: Stable identifier used in ``allowed_tools`` and Claude's tool spec.
    name: str
    #: Natural-language description shown to Claude so it knows when to call.
    description: str
    #: JSON Schema object describing the tool's input parameters.
    input_schema: dict

    @abstractmethod
    async def execute(self, tool_input: dict, context: dict | None = None) -> str:
        """Run the tool with the given input and return a string result.

        ``context`` carries per-request state that isn't part of the model-
        visible ``input_schema`` — e.g. the agent's ``knowledge_base_id`` for
        the document_search tool. Most tools ignore it.
        """
        raise NotImplementedError

    def spec(self) -> dict:
        """Return this tool as a Claude tool-use spec dict."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }
