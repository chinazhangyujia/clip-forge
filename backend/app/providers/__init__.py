from .base import Cut, LlmProvider, PolishCut
from .claude import ClaudeProvider
from .deepseek import DeepSeekProvider

__all__ = [
    "ClaudeProvider",
    "Cut",
    "DeepSeekProvider",
    "LlmProvider",
    "PolishCut",
    "get_provider",
]


def get_provider() -> LlmProvider:
    """Return the configured cutting provider, dispatching on
    CLIPFORGE_LLM_PROVIDER. Defaults to Claude (US dev profile); set to
    "deepseek" for the China-prod profile."""
    from ..config import settings

    name = (settings.clipforge_llm_provider or "claude").lower()

    if name == "claude":
        if not settings.anthropic_api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Copy backend/.env.example to "
                "backend/.env and fill it in (or switch CLIPFORGE_LLM_PROVIDER "
                "to deepseek)."
            )
        return ClaudeProvider(
            api_key=settings.anthropic_api_key,
            model=settings.clipforge_cutting_model or "claude-sonnet-4-6",
        )

    if name == "deepseek":
        if not settings.deepseek_api_key:
            raise RuntimeError(
                "DEEPSEEK_API_KEY is not set. Copy backend/.env.example to "
                "backend/.env and fill it in."
            )
        return DeepSeekProvider(
            api_key=settings.deepseek_api_key,
            model=settings.clipforge_cutting_model or "deepseek-v4-flash",
        )

    raise RuntimeError(
        f"Unknown CLIPFORGE_LLM_PROVIDER: {settings.clipforge_llm_provider!r}. "
        "Expected 'claude' or 'deepseek'."
    )
