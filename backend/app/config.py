from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",
        extra="ignore",
    )

    # Which LLM provider handles cutting / packaging calls. "claude" is the US
    # dev profile; "deepseek" is one of the China-prod-accessible options
    # (Qwen / Kimi / GLM are TBD). Per-provider keys/models live below.
    clipforge_llm_provider: str = "claude"

    anthropic_api_key: str = ""
    deepseek_api_key: str = ""

    # Optional model override. If empty, the active provider picks its own
    # default (Claude → claude-sonnet-4-6, DeepSeek → deepseek-v4-flash).
    clipforge_cutting_model: str = ""

    clipforge_whisper_model: str = "base"
    clipforge_workspace_dir: str = ""

    # LLM-driven filler / repeat / false-start removal. Disabled by
    # default after subjective testing surfaced over-aggressive cuts on
    # real material — the model's calls don't reliably distinguish
    # "verbal tic" from "deliberate emphasis" yet. Set the env var
    # CLIPFORGE_POLISH_CUTS_ENABLED=true to re-enable for testing.
    # Long-pause cutting is unaffected — it has its own (rule-based)
    # path and runs regardless of this flag.
    clipforge_polish_cuts_enabled: bool = False

    @property
    def workspace_dir(self) -> Path:
        if self.clipforge_workspace_dir:
            return Path(self.clipforge_workspace_dir).resolve()
        return (Path(__file__).resolve().parents[1] / "data").resolve()


settings = Settings()
