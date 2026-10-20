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
    # Empty key means resume summaries are unconfigured; /summary reports it
    # rather than failing startup, since the directory works without ICA.
    ica_api_key: str = ""
    ica_base_url: str = "https://api.servicesessentials.ibm.com/v1"
    ica_model: str = "gpt-6-luna"
    # A different, smaller model than the summarizer, so the grader is not marking its own work.
    ica_verifier_model: str = "claude-haiku-5-5"
    ica_timeout_seconds: float = 30.0
    # The w3 unified-profile proxy. https directly: the http form only 302s here.
    resume_base_url: str = "https://w3-ui-unified-profile-proxy.w3-ui.dal.app.cirrus.ibm.com/up-api-proxy/v3/resume"
    resume_timeout_seconds: float = 10.0


settings = Settings()
