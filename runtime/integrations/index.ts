// The integrations library. Add a folder under integrations/<id>/ with an
// index.ts that default-exports defineIntegration({...}), then list it here.
// (A static list keeps the build simple and makes "what can this system do"
// a grep.) Authoring guide: docs/company/integrations.md

import type { Integration } from "../src/integrations/registry.js";
import linkedin from "./linkedin/index.js";
import postmark from "./postmark/index.js";
import content from "./content/index.js";
import slack from "./slack/index.js";
import ga4 from "./ga4/index.js";
import searchConsole from "./search-console/index.js";
import adsMeta from "./ads-meta/index.js";
import telegram from "./telegram/index.js";
import creators from "./creators/index.js";
import geo from "./geo/index.js";
import reddit from "./reddit/index.js";
import x from "./x/index.js";
import postiz from "./postiz/index.js";
import blog from "./blog/index.js";
import instagram from "./instagram/index.js";

export const INTEGRATIONS: Integration[] = [content, blog, postmark, postiz, linkedin, instagram, reddit, x, slack, telegram, creators, geo, ga4, searchConsole, adsMeta];

export function integrationById(id: string): Integration | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}
