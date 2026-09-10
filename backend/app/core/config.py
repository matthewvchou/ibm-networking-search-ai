from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    bluepages_base_url: str = "https://bluepagestst.cpc.ibm.com/BpHttpApisv3"
    bluepages_timeout_seconds: float = 5.0
    search_max_results: int = 50


settings = Settings()
