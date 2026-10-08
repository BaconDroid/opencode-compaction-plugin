/**
 * Files-touched collector for opencode-live-compaction.
 *
 * Tracks which files were read, written, edited, or deleted during a session
 * by listening to tool execution events. Produces a manifest block that
 * can be injected into the compaction prompt.
 */

export type FileOperation = "R" | "W" | "E" | "M" | "D";

export interface FileEntry {
	path: string;
	operations: Set<FileOperation>;
}

const OP_LABELS: Record<FileOperation, string> = {
	R: "read",
	W: "write",
	E: "edit",
	M: "move",
	D: "delete",
};

/**
 * In-memory tracker for files touched during a session.
 * Each session gets its own tracker instance.
 */
export class FilesTouchedTracker {
	private files = new Map<string, FileEntry>();

	/** Record a file operation */
	record(filePath: string, operation: FileOperation): void {
		// Normalize path: strip leading ./ and collapse //
		const normalized = filePath.replace(/^\.\/+/, "").replace(/\/+/g, "/");
		if (!normalized) return;

		let entry = this.files.get(normalized);
		if (!entry) {
			entry = { path: normalized, operations: new Set() };
			this.files.set(normalized, entry);
		}
		entry.operations.add(operation);
	}

	/** Parse tool calls and record file operations */
	processToolCall(tool: string, args: Record<string, unknown>): void {
		switch (tool) {
			case "read":
			case "file_read": {
				const path = extractPath(args, ["filePath", "path", "file"]);
				if (path) this.record(path, "R");
				break;
			}
			case "write":
			case "file_write": {
				const path = extractPath(args, ["filePath", "path", "file"]);
				if (path) this.record(path, "W");
				break;
			}
			case "edit":
			case "file_edit":
			case "patch":
			case "multiedit": {
				const path = extractPath(args, ["filePath", "path", "file"]);
				if (path) this.record(path, "E");
				break;
			}
			case "bash":
			case "shell": {
				const cmd = typeof args.command === "string" ? args.command : "";
				for (const { path, op } of commandOperations(cmd)) {
					this.record(path, op);
				}
				break;
			}
			case "delete":
			case "file_delete": {
				const path = extractPath(args, ["filePath", "path", "file"]);
				if (path) this.record(path, "D");
				break;
			}
		}
	}

	/** Render the files-touched manifest as a Markdown block */
	renderManifest(): string {
		if (this.files.size === 0) return "";

		const entries = Array.from(this.files.values()).sort((a, b) =>
			a.path.localeCompare(b.path),
		);

		const lines = entries.map((entry) => {
			const badges = Array.from(entry.operations)
				.sort()
				.map((op) => `\`${op}\``)
				.join(" ");
			return `- \`${entry.path}\` ${badges}`;
		});

		const legend = Object.entries(OP_LABELS)
			.map(([op, label]) => `\`${op}\`=${label}`)
			.join(", ");

		return [
			"## Files Touched Manifest",
			"",
			`Operations: ${legend}`,
			"",
			...lines,
		].join("\n");
	}

	/** Get the number of tracked files */
	get size(): number {
		return this.files.size;
	}

	/** Reset the tracker */
	clear(): void {
		this.files.clear();
	}
}

// --- Helpers ---

function extractPath(
	args: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const val = args[key];
		if (typeof val === "string" && val.trim()) return val.trim();
	}
	return undefined;
}

/**
 * Best-effort extraction of file paths and their operation from a shell command
 * (`cat`/`git` → read, `touch`/`cp`/`mkdir` → write, `vim` → edit, `mv` → move,
 * `rm` → delete).
 */
function commandOperations(
	cmd: string,
): Array<{ path: string; op: FileOperation }> {
	const results: Array<{ path: string; op: FileOperation }> = [];
	const add = (candidate: string | undefined, op: FileOperation): void => {
		if (candidate && !candidate.startsWith("-") && looksLikePath(candidate)) {
			results.push({ path: candidate, op });
		}
	};

	// `\b` anchors the verb so e.g. `copycat` is not read as `cat`.
	const single: Array<[RegExp, FileOperation]> = [
		[/\b(?:cat|head|tail|less|more)\s+["']?([^\s"']+)["']?/g, "R"],
		[/\b(?:touch|mkdir|chmod|chown)\s+["']?([^\s"']+)["']?/g, "W"],
		[/\b(?:rm)\s+["']?([^\s"']+)["']?/g, "D"],
		[/\b(?:vim|nano|code|edit)\s+["']?([^\s"']+)["']?/g, "E"],
		[/\b(?:git)\s+(?:add|checkout|restore|diff)\s+["']?([^\s"']+)["']?/g, "R"],
		[/\b(?:grep|rg|find|ag)\s+.*["']?([^\s"']+\.\w+)["']?/g, "R"],
	];
	for (const [pattern, op] of single) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(cmd)) !== null) add(match[1], op);
	}

	// `cp`/`mv` take a source and a destination.
	const pairs: Array<[RegExp, FileOperation]> = [
		[/\b(?:cp)\s+["']?([^\s"']+)["']?\s+["']?([^\s"']+)["']?/g, "W"],
		[/\b(?:mv)\s+["']?([^\s"']+)["']?\s+["']?([^\s"']+)["']?/g, "M"],
	];
	for (const [pattern, op] of pairs) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(cmd)) !== null) {
			add(match[1], op);
			add(match[2], op);
		}
	}

	return results;
}

function looksLikePath(s: string): boolean {
	// Has a slash, starts with ./ or ../, or has a file extension
	return s.includes("/") || s.startsWith(".") || /\.\w{1,10}$/.test(s);
}
