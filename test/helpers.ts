import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Build setup/cleanup callbacks that isolate a temp dir and the global XDG
 * config dir so the machine's real config is never read.
 */
export function makeTmpSetup(dir: string) {
	const originalXdg = process.env.XDG_CONFIG_HOME;
	return {
		setup(): void {
			if (existsSync(dir)) rmSync(dir, { recursive: true });
			mkdirSync(dir, { recursive: true });
			mkdirSync(join(dir, ".opencode"), { recursive: true });
			mkdirSync(join(dir, "xdg"), { recursive: true });
			process.env.XDG_CONFIG_HOME = join(dir, "xdg");
		},
		cleanup(): void {
			if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = originalXdg;
			if (existsSync(dir)) rmSync(dir, { recursive: true });
		},
	};
}
