/**
 * DataSourceManager — parent-side lifecycle for datasource child processes.
 *
 * Scope of this MVP:
 *   - One child per datasource node (no refcount / sharing across nodes).
 *   - Spawned eagerly when `start()` is called by the canvas tool;
 *     stopped on app quit or explicit `stop()`.
 *   - No restart-from-spec on app start — children are ephemeral. Spec
 *     persistence comes later (when nodes need to survive across launches).
 *
 * Forks the **same** bundle as the Electron main process, with
 * `--datasource-child` in argv and `ELECTRON_RUN_AS_NODE=1` in env so
 * the child runs as plain Node. argv (not env) carries the routing flag
 * so it does NOT propagate to grandchildren — pulse-sandbox forks its
 * own runners and they must NOT start as datasource children.
 */

import { fork, type ChildProcess } from "node:child_process";
import { app } from "electron";
import type {
  ChildInitMessage,
  ChildToParentMessage,
  DatasourceSpec,
} from "./types";

interface RunningInstance {
  id: string;
  child: ChildProcess;
  port: number;
  /** Epoch millis when start() resolved — used by the reconciler to
   *  skip recently-spawned children whose canvas node / persisted spec
   *  may not have been written yet. */
  startedAt: number;
}

export class DataSourceManager {
  private instances = new Map<string, RunningInstance>();
  private shutdownInstalled = false;

  private installShutdownHook(): void {
    if (this.shutdownInstalled) return;
    this.shutdownInstalled = true;
    // Kill every child when the app is about to quit. `before-quit` fires
    // before windows close, giving us a chance to send SIGTERM before
    // Electron tears down the IPC channel.
    app.on("before-quit", () => {
      for (const inst of this.instances.values()) {
        try {
          inst.child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
      this.instances.clear();
    });
  }

  /**
   * Fork a child for `id` with the given spec. Resolves with the bound
   * loopback port once the child reports `ready`. If a child for `id`
   * already exists it is killed first (caller-level "restart" semantics).
   */
  async start(id: string, spec: DatasourceSpec): Promise<{ port: number }> {
    this.installShutdownHook();
    await this.stop(id);

    // Use the main bundle's path — fork() defaults to the current Node
    // entry, but in Electron we want to be explicit and re-route via
    // argv. `process.argv[1]` is the JS entry script for both Electron
    // main and forked Node children.
    const entry = process.argv[1];
    if (!entry) {
      throw new Error("cannot locate main entry script for fork");
    }

    const child = fork(entry, ["--datasource-child"], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      serialization: "advanced",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    });

    const ready = new Promise<{ port: number }>((resolve, reject) => {
      const onMessage = (msg: ChildToParentMessage): void => {
        if (msg.type === "ready") {
          cleanup();
          resolve({ port: msg.port });
        } else if (msg.type === "error") {
          cleanup();
          try {
            child.kill();
          } catch {
            // ignore
          }
          reject(new Error(`datasource child failed: ${msg.message}`));
        }
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        reject(
          new Error(
            `datasource child exited before ready (code=${code} signal=${signal})`,
          ),
        );
      };
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        child.off("message", onMessage as (msg: unknown) => void);
        child.off("exit", onExit);
        child.off("error", onError);
      };
      child.on("message", onMessage as (msg: unknown) => void);
      child.once("exit", onExit);
      child.once("error", onError);
    });

    const init: ChildInitMessage = { type: "init", spec };
    child.send(init);

    const { port } = await ready;

    this.instances.set(id, { id, child, port, startedAt: Date.now() });
    // Clean up the map entry if the child dies on its own later.
    child.on("exit", () => {
      const current = this.instances.get(id);
      if (current && current.child === child) {
        this.instances.delete(id);
      }
    });

    return { port };
  }

  async stop(id: string): Promise<void> {
    const inst = this.instances.get(id);
    if (!inst) return;
    this.instances.delete(id);
    try {
      inst.child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  list(): Array<{
    id: string;
    port: number;
    pid: number | undefined;
    startedAt: number;
  }> {
    return Array.from(this.instances.values()).map((i) => ({
      id: i.id,
      port: i.port,
      pid: i.child.pid,
      startedAt: i.startedAt,
    }));
  }
}
