export type Launch = {
  symbol: string;
  name: string;
  progress: number;
  marketCap: string;
  volume: string;
  holders: string;
  tag: "Hot" | "Bear Tracks" | "New";
};

export const launches: Launch[] = [
  {
    symbol: "$GRIZZ",
    name: "Grizzly Mode",
    progress: 78,
    marketCap: "$48.2K",
    volume: "$112K",
    holders: "844",
    tag: "Hot",
  },
  {
    symbol: "$HONEY",
    name: "Honey Trap",
    progress: 54,
    marketCap: "$31.7K",
    volume: "$79K",
    holders: "519",
    tag: "Bear Tracks",
  },
  {
    symbol: "$CAVE",
    name: "Cave Club",
    progress: 22,
    marketCap: "$12.4K",
    volume: "$28K",
    holders: "203",
    tag: "New",
  },
];
