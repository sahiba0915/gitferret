import chalk from "chalk";

type LogLevel = "debug" | "info" | "warn" | "error";

function levelEnabled(level: LogLevel): boolean {
  const raw = (process.env.PRLENS_LOG_LEVEL ?? "info").toLowerCase();
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const current = (Object.keys(order) as LogLevel[]).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : "info";
  return order[level] >= order[current];
}

function ts(): string {
  return new Date().toISOString();
}

export const logger = {
  debug(message: string) {
    if (!levelEnabled("debug")) return;
    console.log(`${chalk.gray(ts())} ${chalk.gray("DEBUG")} ${message}`);
  },
  info(message: string) {
    if (!levelEnabled("info")) return;
    console.log(`${chalk.gray(ts())} ${chalk.cyan("INFO")} ${message}`);
  },
  warn(message: string) {
    if (!levelEnabled("warn")) return;
    console.warn(`${chalk.gray(ts())} ${chalk.yellow("WARN")} ${message}`);
  },
  error(message: string) {
    if (!levelEnabled("error")) return;
    console.error(`${chalk.gray(ts())} ${chalk.red("ERROR")} ${message}`);
  }
};

