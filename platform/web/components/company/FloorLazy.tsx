"use client";

import dynamic from "next/dynamic";
import type { Graph } from "../../lib/hive";

const Floor = dynamic(() => import("./Floor").then((m) => m.Floor), {
  ssr: false,
  loading: () => (
    <div className="card grid h-[460px] place-items-center">
      <p className="label breathe">Loading the floor</p>
    </div>
  ),
});

export function FloorLazy({ slug, initial, height }: { slug: string; initial: Graph; height?: number | string }) {
  return <Floor slug={slug} initial={initial} height={height} />;
}
