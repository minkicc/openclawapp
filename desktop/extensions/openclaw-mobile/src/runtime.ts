import { createPluginRuntimeStore } from "openclaw/plugin-sdk/compat";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const { setRuntime: setOpenClawMobileRuntime, getRuntime: getOpenClawMobileRuntime } =
  createPluginRuntimeStore<PluginRuntime>("OpenClaw Mobile runtime not initialized");

export { getOpenClawMobileRuntime, setOpenClawMobileRuntime };
