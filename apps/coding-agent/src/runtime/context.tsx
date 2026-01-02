import { createContext, useContext, type JSX } from "solid-js"
import type { AppRuntime } from "./create-runtime.js"

const RuntimeContext = createContext<AppRuntime | null>(null)

export const RuntimeProvider = (props: { runtime: AppRuntime; children: JSX.Element }) => (
	<RuntimeContext.Provider value={props.runtime}>{props.children}</RuntimeContext.Provider>
)

export const useRuntime = (): AppRuntime => {
	const ctx = useContext(RuntimeContext)
	if (!ctx) {
		throw new Error("RuntimeContext not found")
	}
	return ctx
}
