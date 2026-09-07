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

import googleDrive from "./google-drive/index.js";
import googleSheets from "./google-sheets/index.js";
import googleCalendar from "./google-calendar/index.js";
import gmail from "./gmail/index.js";
import whatsapp from "./whatsapp/index.js";
import facebook from "./facebook/index.js";
import youtube from "./youtube/index.js";
import tiktok from "./tiktok/index.js";
import discord from "./discord/index.js";
import notion from "./notion/index.js";
import github from "./github/index.js";
import hubspot from "./hubspot/index.js";
import webhook from "./webhook/index.js";
import stripe from "./stripe/index.js";
import razorpay from "./razorpay/index.js";
export const INTEGRATIONS: Integration[] = [content, blog, postmark, postiz, linkedin, instagram, reddit, x, slack, telegram, creators, geo, ga4, searchConsole, adsMeta, googleDrive, googleSheets, googleCalendar, gmail, facebook, whatsapp, youtube, tiktok, discord, notion, github, hubspot, webhook, stripe, razorpay];

export function integrationById(id: string): Integration | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}
