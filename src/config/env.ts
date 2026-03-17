import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  const result = dotenv.config({ quiet: true });
  loaded = true;

  if (result.error) {
    // No .env is a normal case in production; keep it non-fatal.
    logger.debug(`dotenv not loaded: ${result.error.message}`);
  } else {
    logger.debug("dotenv loaded");
  }
}

export function getEnv(name: string): string | undefined {
  return process.env[name];
}

