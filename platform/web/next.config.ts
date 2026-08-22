import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native modules stay outside the bundle (loaded at runtime)
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
};

export default nextConfig;
