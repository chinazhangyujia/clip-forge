from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",
        extra="ignore",
    )

    anthropic_api_key: str = ""
    clipforge_cutting_model: str = "claude-sonnet-4-6"
    clipforge_whisper_model: str = "base"
    clipforge_workspace_dir: str = ""

    @property
    def workspace_dir(self) -> Path:
        if self.clipforge_workspace_dir:
            return Path(self.clipforge_workspace_dir).resolve()
        return (Path(__file__).resolve().parents[1] / "data").resolve()


settings = Settings()
