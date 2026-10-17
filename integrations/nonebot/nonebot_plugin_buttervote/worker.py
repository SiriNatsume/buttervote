from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from contextlib import suppress
from typing import Any, Protocol
from uuid import UUID

import httpx
from nonebot.log import logger

from .config import Config, QQ_PATTERN


class BotAPI(Protocol):
    self_id: str

    async def call_api(self, api: str, **data: Any) -> Any: ...


class IncompleteRoster(ValueError):
    pass


def _qq_id(value: Any) -> str:
    if type(value) not in {str, int} or not QQ_PATTERN.fullmatch(str(value)):
        raise IncompleteRoster
    return str(value)


def _clip_text(value: str) -> str:
    # The website's Zod max(120) counts UTF-16 units, including emoji pairs.
    return value.encode("utf-16-le", errors="replace")[:240].decode("utf-16-le", errors="ignore")


def normalize_roster(members: Any, before: Any, after: Any, group_id: str) -> list[dict[str, str]]:
    if not isinstance(before, dict) or not isinstance(after, dict):
        raise IncompleteRoster
    if _qq_id(before.get("group_id")) != group_id or _qq_id(after.get("group_id")) != group_id:
        raise IncompleteRoster
    count = before.get("member_count")
    if (
        type(count) is not int or not 1 <= count <= 10000
        or type(after.get("member_count")) is not int or after["member_count"] != count
        or not isinstance(members, list) or len(members) != count
    ):
        raise IncompleteRoster
    seen: set[str] = set()
    roster = []
    for member in members:
        if not isinstance(member, dict) or _qq_id(member.get("group_id")) != group_id:
            raise IncompleteRoster
        qq = _qq_id(member.get("user_id"))
        nickname, card = member.get("nickname"), member.get("card")
        if qq in seen or not isinstance(nickname, str) or (card is not None and not isinstance(card, str)):
            raise IncompleteRoster
        seen.add(qq)
        roster.append({"qq_user_id": qq, "nickname": _clip_text(nickname), "card": _clip_text(card or "")})
    return roster


class GroupSyncWorker:
    """One sequential poller per NoneBot process, using its connected Bot."""

    def __init__(
        self, config: Config, bot_provider: Callable[[], Iterable[BotAPI]],
        *, client: httpx.AsyncClient | None = None,
    ) -> None:
        self.config = config
        self._bot_provider = bot_provider
        self._client = client
        self._owns_client = client is None
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._pending: tuple[str, dict[str, Any]] | None = None
        self._wait_reason: str | None = None
        self._last_error: str | None = None

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        if not self.config.buttervote_sync_enabled:
            logger.info("Butter Vote 群成员同步插件已关闭。")
            return
        try:
            self.config.validate_sync()
        except ValueError as error:
            logger.warning(f"Butter Vote 群成员同步未启动：{error}。")
            return
        self._task = asyncio.create_task(self._poll(), name="buttervote-group-sync")
        logger.info("Butter Vote 群成员同步已随 Bot 启动。")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _poll(self) -> None:
        while True:
            try:
                await self.run_once()
                if self._last_error is not None:
                    logger.info("Butter Vote 群成员同步连接已恢复。")
                    self._last_error = None
            except Exception as error:
                # Never log exception text/tracebacks: they may include URLs,
                # access tokens, request bodies, or the roster itself.
                label = f"HTTP {error.response.status_code}" if isinstance(error, httpx.HTTPStatusError) else type(error).__name__
                if label != self._last_error:
                    logger.warning(f"Butter Vote 同步暂时不可用（{label}），将自动重试。")
                    self._last_error = label
            await asyncio.sleep(self.config.buttervote_sync_poll_seconds)

    def _select_bot(self) -> BotAPI | None:
        bots = list(self._bot_provider())
        selected_id = self.config.buttervote_sync_bot_id
        if selected_id:
            bots = [bot for bot in bots if bot.self_id == selected_id]
        reason = "offline" if not bots else "multiple" if len(bots) > 1 else None
        if reason != self._wait_reason:
            if reason == "offline":
                logger.info("Butter Vote 同步等待 OneBot v11 连接，暂不领取任务。")
            elif reason == "multiple":
                logger.warning("Butter Vote 检测到多个 OneBot，请配置 BUTTERVOTE_SYNC_BOT_ID；暂不领取任务。")
            self._wait_reason = reason
        return bots[0] if reason is None else None

    async def _post(self, path: str, body: dict[str, Any]) -> Any:
        if self._client is None:
            self._client = httpx.AsyncClient(trust_env=False, follow_redirects=False)
        response = await self._client.post(
            self.config.site_url + path,
            headers={"Authorization": f"Bearer {self.config.bot_api_secret.get_secret_value()}"},
            json=body, timeout=self.config.buttervote_sync_timeout_seconds, follow_redirects=False,
        )
        response.raise_for_status()
        return response.json()

    async def _publish_pending(self) -> bool:
        assert self._pending is not None
        job_id, body = self._pending
        try:
            result = await self._post(f"/api/bot/group-sync/{job_id}", body)
        except httpx.HTTPStatusError as error:
            if error.response.status_code in {400, 404, 409, 413, 422}:
                self._pending = None
                logger.warning("Butter Vote 同步结果未被接受，任务可能已过期；请查看后台状态后重新同步。")
                return False
            raise
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise ValueError("invalid_sync_response")
        self._pending = None
        if "error" in body:
            logger.warning(f"Butter Vote 群同步未完成（{body['error']}），已保留网站原名单。")
        else:
            logger.info(f"Butter Vote 群同步完成：{len(body['members'])} 人。")
        return True

    async def run_once(self) -> bool:
        async with self._lock:
            self.config.validate_sync()
            # Retry a completed snapshot before claiming anything else, even
            # if the Bot disconnected after reading the roster.
            if self._pending is not None:
                return await self._publish_pending()
            bot = self._select_bot()
            if bot is None:
                return False
            response = await self._post("/api/bot/group-sync/claim", {})
            if not isinstance(response, dict) or "job" not in response:
                raise ValueError("invalid_sync_response")
            job = response["job"]
            if job is None:
                return False
            if not isinstance(job, dict):
                raise ValueError("invalid_sync_job")
            try:
                job_id, lease_id = str(UUID(job["id"])), str(UUID(job["leaseId"]))
                group_id = _qq_id(job["qqGroupId"])
            except (ValueError, KeyError, TypeError, AttributeError):
                raise ValueError("invalid_sync_job") from None
            body: dict[str, Any] = {"leaseId": lease_id}
            if not self.config.allows_group(group_id):
                body["error"] = "group_not_allowed"
            else:
                async def call_bot(api: str) -> Any:
                    return await asyncio.wait_for(
                        bot.call_api(api, group_id=int(group_id), no_cache=True),
                        timeout=self.config.buttervote_sync_timeout_seconds,
                    )
                try:
                    # The adapter returns unwrapped data and raises on OneBot
                    # status/retcode failures for both HTTP and WebSocket.
                    before = await call_bot("get_group_info")
                    members = await call_bot("get_group_member_list")
                    after = await call_bot("get_group_info")
                    body["members"] = normalize_roster(members, before, after, group_id)
                except IncompleteRoster:
                    body["error"] = "incomplete_roster"
                except Exception:
                    body["error"] = "bot_unavailable"
            self._pending = (job_id, body)
            return await self._publish_pending()
