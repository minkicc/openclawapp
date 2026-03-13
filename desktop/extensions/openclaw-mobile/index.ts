import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { openclawMobilePlugin } from "./src/channel.js";
import { setOpenClawMobileRuntime } from "./src/runtime.js";

const plugin = {
  id: "openclaw-mobile",
  name: "OpenClaw Mobile",
  description: "OpenClaw mobile relay channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setOpenClawMobileRuntime(api.runtime);
    api.registerChannel({ plugin: openclawMobilePlugin });
  },
};

export default plugin;
