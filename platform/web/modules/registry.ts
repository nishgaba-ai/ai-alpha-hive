import type { DashboardModule } from "./types";
import products from "./products";
import deployments from "./deployments";
import infra from "./infra";

// The single place the dashboard learns what it can do.
// Remove a line and that capability is gone; drop a new module folder and
// add its line here to light it up.
export const registry: DashboardModule[] = [products, deployments, infra];
