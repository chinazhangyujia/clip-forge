from .base import Cut, LlmProvider
from .claude import ClaudeProvider

__all__ = ["Cut", "LlmProvider", "ClaudeProvider", "get_provider"]


def get_provider() -> LlmProvider:
    """Return the configured cutting provider.

    For now hardcoded to Claude (US dev). The China prod profile would swap
    this to a Qwen / Kimi / DeepSeek implementation behind the same interface.
    """
    from ..config import settings

    if not settings.anthropic_api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Copy backend/.env.example to "
            "backend/.env and fill it in."
        )
    return ClaudeProvider(
        api_key=settings.anthropic_api_key,
        model=settings.clipforge_cutting_model,
    )
