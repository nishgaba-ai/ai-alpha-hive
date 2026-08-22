import type { JSX } from "react";
import type { Session } from "../lib/auth";

// A dashboard module is a self-contained folder under modules/ exporting
// this manifest. The dashboard renders whatever the registry lists — adding
// or removing a capability is one folder plus one registry line, and later
// `hive add` will inject entries the same way (see docs/module-spec.md in
// the engine repo).
export type ModuleContext = { session: Session };

export type DashboardModule = {
  id: string;
  version: string;
  title: string;
  description: string;
  Panel: (ctx: ModuleContext) => Promise<JSX.Element> | JSX.Element;
};
