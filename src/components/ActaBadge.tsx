import type { ActaLevel } from "../../shared/types";

const names: Record<ActaLevel, string> = {
  L1: "Task Map",
  L2: "Expertise",
  L3: "Simulation",
};

export default function ActaBadge({ level }: { level: ActaLevel }) {
  return <span className={`acta-badge ${level.toLowerCase()}`}>{`${level} ${names[level]}`}</span>;
}
