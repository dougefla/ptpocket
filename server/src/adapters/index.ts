import type { Config } from "../config.js";
import { MTeamAdapter } from "./mteam.js";
import type { SiteAdapter } from "./types.js";

export { AdapterError } from "./types.js";
export type { SiteAdapter } from "./types.js";

/** 按配置装配所有启用的原生适配器。填了令牌就算启用。 */
export function buildAdapters(config: Config): SiteAdapter[] {
  const adapters: SiteAdapter[] = [];

  if (config.MTEAM_API_KEY) {
    adapters.push(
      new MTeamAdapter({
        apiKey: config.MTEAM_API_KEY,
        siteUrl: config.MTEAM_URL,
        apiUrl: config.MTEAM_API_URL || undefined,
        mode: config.MTEAM_MODE,
      }),
    );
  }

  return adapters;
}
