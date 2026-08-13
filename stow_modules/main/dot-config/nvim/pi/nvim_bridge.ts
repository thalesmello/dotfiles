/**
 * pi extension: unix socket bridge to Neovim.
 *
 * A superset of carderne/pi-nvim's extension.ts (MIT), which is what
 * ~/.local/share/nvim/lazy/pi-nvim ships. That one speaks only `prompt`, which
 * calls pi.sendUserMessage() and therefore submits the turn. The <leader>as /
 * <leader>. keymaps hand context over without taking the turn, so this adds:
 *
 *   { "type": "insert", "message": "..." }   -> ctx.ui.pasteToEditor()
 *
 * which drops the text into pi's input line and leaves it there, matching how
 * the Claude/Codex @-mention commands behave.
 *
 * Discovery is kept compatible with pi-nvim's Lua side: the socket and its
 * .info manifest go in /tmp/pi-nvim-sockets, so :PiSessions and
 * get_socket_path() still find this session. The filename carries an extra
 * `-nvim` and the manifest an `insert: true`, so that this can coexist with the
 * upstream extension (if the package is also installed, both listen, on
 * different paths) and so the nvim side can tell which sockets take `insert`.
 *
 * Loaded via `pi --extension <this file>`; see lua/ai_agents.lua.
 */

import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SOCKETS_DIR = "/tmp/pi-nvim-sockets";
const LATEST_LINK = "/tmp/pi-nvim-latest.sock";

function cwdHash(cwd: string): string {
  return crypto.createHash("md5").update(cwd).digest("hex").slice(0, 12);
}

function socketPathFor(cwd: string): string {
  return path.join(SOCKETS_DIR, `${cwdHash(cwd)}-${process.pid}-nvim.sock`);
}

export default function (pi: any) {
  let server: net.Server | null = null;
  let socketPath: string | null = null;

  pi.on("session_start", async (_event: any, ctx: any) => {
    const cwd = ctx.cwd;

    try {
      fs.mkdirSync(SOCKETS_DIR, { recursive: true });
    } catch {}

    socketPath = socketPathFor(cwd);

    try {
      fs.unlinkSync(socketPath);
    } catch {}

    server = net.createServer((conn) => {
      let buffer = "";
      conn.on("data", (data) => {
        buffer += data.toString();
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line) handleMessage(line, conn, ctx);
        }
      });
      conn.on("error", () => {});
    });

    server.listen(socketPath, () => {
      try {
        fs.unlinkSync(LATEST_LINK);
      } catch {}
      try {
        fs.symlinkSync(socketPath!, LATEST_LINK);
      } catch {}

      try {
        fs.writeFileSync(
          socketPath + ".info",
          JSON.stringify({
            cwd,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            insert: true,
          }),
        );
      } catch {}
    });

    server.on("error", (err) => {
      ctx.ui.notify(`nvim bridge error: ${err.message}`, "error");
    });
  });

  function respond(conn: net.Socket, obj: any) {
    try {
      conn.write(JSON.stringify(obj) + "\n");
    } catch {}
  }

  function handleMessage(raw: string, conn: net.Socket, ctx: any) {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === "ping") {
        respond(conn, { ok: true, type: "pong" });
        return;
      }

      if (typeof msg.message !== "string") {
        respond(conn, { ok: false, error: "Missing message" });
        return;
      }

      // Snap out of the terminal's scrollback viewer without clearing history,
      // so the editor is actually on screen when the text lands.
      process.stdout.write("\x1b[?1049h\x1b[?1049l");

      if (msg.type === "insert") {
        // pasteToEditor is `editor.handleInput("\x1b[200~" + text + "\x1b[201~")`,
        // i.e. the same bracketed paste a terminal would deliver. It updates the
        // editor buffer but does not repaint on its own -- a socket message is
        // not a UI event -- so the text is invisible until pi redraws for some
        // other reason. Touching the status bar forces that redraw.
        ctx.ui.pasteToEditor(msg.message);
        ctx.ui.setStatus("nvim", "");
        respond(conn, { ok: true });
        return;
      }

      if (msg.type === "prompt") {
        pi.sendUserMessage(msg.message, { deliverAs: "followUp" });
        respond(conn, { ok: true });
        return;
      }

      respond(conn, { ok: false, error: `Unknown command type: ${msg.type}` });
    } catch (e: any) {
      respond(conn, { ok: false, error: `Parse error: ${e.message}` });
    }
  }

  function cleanup() {
    if (server) {
      server.close();
      server = null;
    }
    try {
      fs.unlinkSync(socketPath!);
    } catch {}
    try {
      if (fs.readlinkSync(LATEST_LINK) === socketPath) fs.unlinkSync(LATEST_LINK);
    } catch {}
    try {
      fs.unlinkSync(socketPath + ".info");
    } catch {}
  }

  pi.on("session_shutdown", async () => cleanup());
  process.on("exit", cleanup);
}
