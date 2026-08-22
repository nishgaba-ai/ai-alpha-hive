import type { DashboardModule } from "./types";
import products from "./products";
import activity from "./activity";
import infra from "./infra";
import rbac from "./rbac";

// The single place the dashboard learns what it can do.
// Remove a line and that capability is gone; drop a new module folder and
// add its line here to light it up. (rbac arrived exactly this way.)
export const registry: DashboardModule[] = [products, activity, infra, rbac];
