import { createContext, useContext, type JSX } from "solid-js"
import type { RuntimeContext as RuntimeServices } from "./factory.js"

const RuntimeContext = createContext<RuntimeServices | null>(null)

export const RuntimeProvider = (props: { runtime: RuntimeServices; children: JSX.Element }) => (
	<RuntimeContext.Provider value={props.runtime}>{props.children}</RuntimeContext.Provider>
)

export const useRuntime = (): RuntimeServices => {
	const ctx = useContext(RuntimeContext)
	if (!ctx) {
		throw new Error("RuntimeContext not found")
	}
	return ctx
}
