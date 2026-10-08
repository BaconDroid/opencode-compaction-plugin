/**
 * Files-touched collector for opencode-live-compaction.
 *
 * Tracks which files were read, written, edited, or deleted during a session
 * from the structured tool calls (`read`, `write`, `edit`, `delete`, …).
 * Shell commands are intentionally not parsed — the heuristics were fragile —
 * so files touched only through `bash` are not listed. Produces a manifest
 * block that can be injected into the compaction prompt.
 */

export type FileOperation = "R" | "W" | "E" | "D";

export interface FileEntry {
	path: string;
	operations: Set<FileOperation>;
}

const OP_LABELS: Record<FileOperation, string> = {
	R: "read",
	W: "write",
	E: "edit",
	D: "delete",
};

/**
 * In-memory tracker for files touched during a session.
 * Each session gets its own tracker instance.
 */
export class FilesTouchedTracker {
	private files = new Map<string, FileEntry>();

	record(filePath: string, operation: FileOperation): void {
		const normalized = filePath.replace(/^\.\/+/, "").replace(/\/+/g, "/");
		if (!normalized) return;

		let entry = this.files.get(normalized);
		if (!entry) {
			entry = { path: normalized, operations: new Set() };
			this.files.set(normalized, entry);
		}
		entry.operations.add(operation);
	}

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
			case "delete":
			case "file_delete": {
				const path = extractPath(args, ["filePath", "path", "file"]);
				if (path) this.record(path, "D");
				break;
			}
		}
	}

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

	get size(): number {
		return this.files.size;
	}

	clear(): void {
		this.files.clear();
	}
}


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
