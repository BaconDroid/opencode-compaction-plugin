/** Shared message builders for the tests. */

export const textMsg = (role: string, text: string) => ({
	info: { role },
	parts: [{ type: "text", text }],
});

export const toolMsg = (tool: string, output: string, callID?: string) => ({
	info: { role: "assistant" },
	parts: [{ type: "tool", tool, callID, state: { output } }],
});

export const blockMsg = (id: string, label: string, body: string) => ({
	info: { role: "assistant" },
	parts: [
		{
			type: "text",
			text: `<compressed-block id="${id}" label="${label}">${body}</compressed-block>`,
		},
	],
});
