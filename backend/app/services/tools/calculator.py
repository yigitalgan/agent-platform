"""Calculator tool — safe arithmetic without ``eval``.

Parses the expression into an AST and walks it, allowing only a whitelist of
numeric operators, a few math functions, and constants (pi/e). Anything else
(names, attribute access, calls to unknown functions, comprehensions, etc.)
raises, so there is no way to reach arbitrary Python execution.
"""

import ast
import asyncio
import math
import operator

from app.services.tools.base import Tool

# Cap exponentiation so a small expression like ``9**9**9`` can't produce an
# astronomically large integer and burn CPU/memory. Not an RCE guard (the AST
# whitelist already blocks that) — a resource-exhaustion (DoS) guard.
_MAX_POW_OPERAND = 1000


def _guarded_pow(base, exp):
    """``base ** exp`` but rejects operands whose magnitude exceeds the cap."""
    if abs(base) > _MAX_POW_OPERAND or abs(exp) > _MAX_POW_OPERAND:
        raise ValueError("sayı çok büyük (üs/taban 1000 sınırını aşıyor)")
    return operator.pow(base, exp)


# Binary operators we allow.
_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: _guarded_pow,
}

# Unary operators (e.g. -3, +3).
_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

# A small, safe function/constant surface.
_FUNCTIONS = {
    "sqrt": math.sqrt,
    "abs": abs,
    "round": round,
    "floor": math.floor,
    "ceil": math.ceil,
    "log": math.log,
    "log10": math.log10,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "exp": math.exp,
}
_CONSTANTS = {"pi": math.pi, "e": math.e, "tau": math.tau}


def _eval_node(node: ast.AST):
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("yalnızca sayılar desteklenir")
    if isinstance(node, ast.BinOp):
        op = _BIN_OPS.get(type(node.op))
        if op is None:
            raise ValueError("desteklenmeyen operatör")
        return op(_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp):
        op = _UNARY_OPS.get(type(node.op))
        if op is None:
            raise ValueError("desteklenmeyen tekli operatör")
        return op(_eval_node(node.operand))
    if isinstance(node, ast.Name):
        if node.id in _CONSTANTS:
            return _CONSTANTS[node.id]
        raise ValueError(f"bilinmeyen ad: {node.id}")
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCTIONS:
            raise ValueError("izin verilmeyen fonksiyon çağrısı")
        if node.keywords:
            raise ValueError("adlandırılmış argüman desteklenmiyor")
        args = [_eval_node(arg) for arg in node.args]
        return _FUNCTIONS[node.func.id](*args)
    raise ValueError("desteklenmeyen ifade")


def safe_eval(expression: str) -> float:
    """Evaluate a simple arithmetic expression safely, returning a number."""
    tree = ast.parse(expression, mode="eval")
    return _eval_node(tree)


class CalculatorTool(Tool):
    name = "calculator"
    description = (
        "Matematiksel ifadeleri hesaplar. Toplama, çıkarma, çarpma, bölme, "
        "üs (**), mod (%), parantez ve sqrt/abs/round/log/sin/cos gibi temel "
        "fonksiyonları destekler. Örnek girdi: '347 * 29' veya 'sqrt(144) + 2'."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "Hesaplanacak matematiksel ifade, ör. '347 * 29'.",
            }
        },
        "required": ["expression"],
    }

    async def execute(self, tool_input: dict, context: dict | None = None) -> str:
        expression = str(tool_input.get("expression", "")).strip()
        if not expression:
            return "hata: boş ifade"
        try:
            # Run the (synchronous, CPU-bound) evaluation off the event loop so
            # a heavy expression can't block the whole server.
            result = await asyncio.to_thread(safe_eval, expression)
        except ZeroDivisionError:
            return "hata: sıfıra bölme"
        except Exception as exc:  # noqa: BLE001 — any parse/eval error is user-facing
            return f"hata: ifade hesaplanamadı ({exc})"
        # Present whole-number floats without a trailing ".0".
        if isinstance(result, float) and result.is_integer():
            result = int(result)
        return str(result)
