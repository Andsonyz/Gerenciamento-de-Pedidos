export interface SimulationConfig {
  mode: "interactive" | "automatic";
  speed: 1 | 2 | 5;
  arrivalSeconds: number;
  preparationSeconds: number;
  diningSeconds: number;
  maxGroups: number;
  seed: number;
  autoKitchen: boolean;
  autoCashier: boolean;
  scenario:
    "normal" | "simultaneous" | "partial-cancellation" | "kitchen-failure" | "shortage";
}
export interface SimulationGroup {
  id: string;
  size: number;
  status: "waiting" | "requesting" | "ordered" | "dining" | "payment" | "completed";
  tableId: number | null;
  sessionId: string | null;
  orderId: string | null;
  waiterId: string | null;
  items: { productId: number; name: string; quantity: number }[];
  dueAt: number;
  error: string | null;
}
export interface SimulationEvent {
  id: number;
  virtualTime: string;
  message: string;
  type: "arrival" | "service" | "kitchen" | "payment" | "control" | "error";
}
export interface SimulationState {
  id: string | null;
  status: "idle" | "running" | "paused" | "stopped" | "completed";
  mode: SimulationConfig["mode"];
  speed: SimulationConfig["speed"];
  virtualTime: string;
  elapsedSeconds: number;
  config: SimulationConfig;
  groups: SimulationGroup[];
  events: SimulationEvent[];
  metrics: { arrived: number; waiting: number; completed: number; active: number };
}
