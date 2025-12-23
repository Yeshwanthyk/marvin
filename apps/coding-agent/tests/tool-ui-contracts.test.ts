import { describe, expect, it } from "bun:test"
import { getAgentDelegationArgs, getAgentDelegationUi } from "../src/tool-ui-contracts.js"

describe("tool-ui-contracts", () => {
	it("accepts delegation args (chain)", () => {
		expect(getAgentDelegationArgs({ chain: [{ agent: "a", task: "t" }] })).not.toBeNull()
	})

	it("rejects invalid delegation args", () => {
		expect(getAgentDelegationArgs({ chain: ["x"] })).toBeNull()
	})

	it("accepts delegation ui", () => {
		const details = {
			ui: {
				kind: "agent_delegation",
				mode: "chain",
				items: [{ id: "1", agent: "a", task: "t", status: "running" }],
			},
		}
		expect(getAgentDelegationUi(details)).not.toBeNull()
	})

	it("rejects invalid delegation ui", () => {
		const details = {
			ui: {
				kind: "agent_delegation",
				mode: "chain",
				items: [{ id: "1", agent: "a", task: "t", status: "bogus" }],
			},
		}
		expect(getAgentDelegationUi(details)).toBeNull()
	})
})
