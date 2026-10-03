/**
 * Entry point.
 *
 * The face is chosen from argv:
 *
 *   terminal-wallet --selftest    no wallet, no password, safe to automate
 *   terminal-wallet --status      full boot + state dump (prompts once)
 *   terminal-wallet --export-commitments <file>
 *                                 full boot, then the wallets' blinded commitments
 *   terminal-wallet               the deck
 *
 * `clearConsoleBuffer()` and `setConsoleTitle()` write ANSI escapes to stdout,
 * so they happen inside main() once argv has been read rather than at module
 * scope. A mode chosen from argv that prints something the caller has to read
 * can then run ahead of them, instead of having its output cleared by a call it
 * never reached.
 */
import { runDiagnostic } from "./diagnostic/report";
import { clearConsoleBuffer, setConsoleTitle } from "./platform/console";
import { installProcessHandlers } from "./platform/lifecycle";
import { createLogger } from "./platform/logger";

const log = createLogger("main");

const main = async () => {
  // Every file and directory the wallet creates is owner-only, the engine
  // database's own files included, which native code creates.
  process.umask(0o077);
  const argv = process.argv.slice(2);

  // Before anything that can fail, so a crash during boot is reported and torn
  // down rather than swallowed.
  installProcessHandlers();
  clearConsoleBuffer();
  setConsoleTitle();

  // The diagnostic modes are explicit. They stay available now the deck is the
  // default, because "is it the wallet or the network" is much easier to answer
  // from a state dump than from a rendered screen.
  if (["--selftest", "--status", "--export-commitments"].some((m) => argv.includes(m))) {
    process.exit(await runDiagnostic(argv));
  }

  // Loaded on demand: the terminal UI pulls in blessed and builds a screen, and
  // the diagnostic modes above have no use for either.
  const { runDeck } = await import("./tui/entry.js");
  await runDeck();
};

main().catch((err: unknown) => {
  log.error("fatal error during startup", err);
  process.exit(1);
});
