export const SIMULATION =
  typeof window !== "undefined" && /^\/simulacao(?:\/|$)/.test(window.location.pathname);
export const BASE_PATH = SIMULATION ? "/simulacao" : "";
export const ENVIRONMENT = SIMULATION ? "training" : "operational";
