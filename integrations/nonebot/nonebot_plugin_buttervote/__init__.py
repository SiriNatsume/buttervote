"""Butter Vote roster sync using the existing NoneBot/OneBot v11 connection."""
from __future__ import annotations

import importlib
import sys

from nonebot import get_bots, get_driver, get_plugin_config
from nonebot.adapters.onebot.v11 import Bot
from nonebot.plugin import PluginMetadata

from .config import Config


__plugin_meta__ = PluginMetadata(
    name="Butter Vote 群成员同步",
    description="随 Bot 运行，领取 Butter Vote 后台任务并同步完整 QQ 群成员名单",
    usage="在 Bot 配置中设置网站地址、BOT_API_SECRET 和群号白名单；在网站后台点击同步。",
    type="application", config=Config, supported_adapters={"~onebot.v11"},
)


def __getattr__(name: str):
    # Match the existing Potato plugins: importing config/worker for tools or
    # tests must not prevent a later normal NoneBot plugin load.
    if name != "__plugin__":
        raise AttributeError(name)
    from nonebot.plugin import get_available_plugin_names
    try:
        get_driver()
    except ValueError:
        raise AttributeError(name) from None
    if __name__.rsplit(".", 1)[-1] not in get_available_plugin_names():
        raise AttributeError(name)
    bootstrap = sys.modules.pop(__name__)
    try:
        active = importlib.import_module(__name__)
        plugin = active.__dict__.get("__plugin__")
        if plugin is None:
            raise AttributeError(name)
    except BaseException:
        sys.modules[__name__] = bootstrap
        raise
    for attribute in ("__plugin__", "__plugin_meta__", "plugin_config", "worker"):
        bootstrap.__dict__[attribute] = active.__dict__[attribute]
    return plugin


if "__plugin__" in globals():
    from .worker import GroupSyncWorker

    plugin_config = get_plugin_config(Config)
    worker = GroupSyncWorker(
        plugin_config,
        lambda: [bot for bot in get_bots().values() if isinstance(bot, Bot)],
    )
    driver = get_driver()
    driver.on_startup(worker.start)
    driver.on_shutdown(worker.stop)


__all__ = ["Config"]
