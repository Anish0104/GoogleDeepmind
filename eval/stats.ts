// OWNER: Dev 4. Wilson intervals; one sample per scene.
import { notImplemented } from "@/lib/not-implemented";

export interface Rate {
  count: number;
  total: number;
  rate: number;
  low: number; // 95% Wilson interval
  high: number;
}

export function wilson(_count: number, _total: number, _z = 1.96): Rate {
  return notImplemented("Dev 4", "wilson");
}
