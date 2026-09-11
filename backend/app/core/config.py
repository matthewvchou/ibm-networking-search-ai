from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    bluepages_base_url: str = "https://bluepagestst.cpc.ibm.com/BpHttpApisv3"
    bluepages_timeout_seconds: float = 5.0
    # Shorter timeout for the opportunistic first-name wildcard query so a slow/huge
    # match (e.g. a common first name) can't stall the whole search past this.
    bluepages_firstname_timeout_seconds: float = 3.0
    search_max_results: int = 50


settings = Settings()
