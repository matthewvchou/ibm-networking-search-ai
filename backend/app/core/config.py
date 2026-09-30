from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    bluepages_base_url: str = "https://bluepagestst.cpc.ibm.com/BpHttpApisv3"
    bluepages_timeout_seconds: float = 5.0
    # Search gets a longer leash than the rest: SLAPHAPI enforces no server-side
    # size limit, so a legitimately broad name prefix ("sin") can stream ~12MB and
    # take most of 5s. See _search_filter for how the worst cases are kept out.
    slaphapi_search_timeout_seconds: float = 10.0
    search_max_results: int = 50


settings = Settings()
