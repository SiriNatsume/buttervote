from __future__ import annotations

import json
import re
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, SecretStr


QQ_PATTERN = re.compile(r"[1-9][0-9]{4,11}\Z")


class Config(BaseModel):
    buttervote_sync_enabled: bool = True
    buttervote_url: str = ""
    bot_api_secret: SecretStr = Field(default=SecretStr(""), repr=False)
    buttervote_sync_allowed_groups: str | list[str | int] = ""
    buttervote_sync_bot_id: str = ""
    buttervote_sync_poll_seconds: float = Field(default=5, ge=1, le=300)
    buttervote_sync_timeout_seconds: float = Field(default=20, ge=1, le=30)

    @property
    def site_url(self) -> str:
        value = self.buttervote_url.strip()
        try:
            url = urlsplit(value)
            # Accessing port also validates malformed/out-of-range port values.
            _ = url.port
        except ValueError:
            raise ValueError("BUTTERVOTE_URL 地址无效") from None
        if (
            url.scheme not in {"https", "http"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.path not in {"", "/"}
            or url.query
            or url.fragment
            or "\\" in value
            or any(character.isspace() for character in value)
            or (url.scheme == "http" and url.hostname not in {"localhost", "127.0.0.1", "::1"})
        ):
            raise ValueError("BUTTERVOTE_URL 必须是网站 HTTPS 根地址；本机测试可使用 HTTP")
        return value.rstrip("/")

    @property
    def allowed_groups(self) -> frozenset[str]:
        raw = self.buttervote_sync_allowed_groups
        if isinstance(raw, str):
            raw = raw.strip()
            if raw.lower() == "all":
                return frozenset({"all"})
            if raw.startswith("["):
                try:
                    values = json.loads(raw)
                except ValueError:
                    raise ValueError("BUTTERVOTE_SYNC_ALLOWED_GROUPS 格式无效") from None
            else:
                values = [part.strip() for part in raw.split(",") if part.strip()]
        else:
            values = raw
        if not isinstance(values, list) or not values:
            raise ValueError("请配置 BUTTERVOTE_SYNC_ALLOWED_GROUPS 群号白名单")
        if any(type(value) not in {str, int} or not QQ_PATTERN.fullmatch(str(value)) for value in values):
            raise ValueError("BUTTERVOTE_SYNC_ALLOWED_GROUPS 应为数字 QQ 群号列表或 all")
        return frozenset(map(str, values))

    def allows_group(self, group_id: str) -> bool:
        groups = self.allowed_groups
        return "all" in groups or group_id in groups

    def validate_sync(self) -> None:
        self.site_url
        self.allowed_groups
        if not self.bot_api_secret.get_secret_value().strip():
            raise ValueError("请配置与网站一致的 BOT_API_SECRET")
        if self.buttervote_sync_bot_id and not QQ_PATTERN.fullmatch(self.buttervote_sync_bot_id):
            raise ValueError("BUTTERVOTE_SYNC_BOT_ID 必须是 Bot 的数字 QQ 号")
