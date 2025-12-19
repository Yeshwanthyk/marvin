import type { Model, ReasoningEffort } from "@marvin-agents/ai";

export type ThinkingLevel = ReasoningEffort | "off";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export interface ModelCycleState {
	models: Model<any>[];
	currentIndex: number;
	thinkingLevel: ThinkingLevel;
}

/**
 * Create a model cycling state from a list of models
 */
export function createModelCycleState(models: Model<any>[], initialModel?: Model<any>): ModelCycleState {
	const currentIndex = initialModel 
		? models.findIndex(m => m.id === initialModel.id && m.provider === initialModel.provider)
		: 0;
	
	return {
		models,
		currentIndex: currentIndex >= 0 ? currentIndex : 0,
		thinkingLevel: models[0]?.reasoning ? "medium" : "off",
	};
}

/**
 * Cycle to next model in list
 * @returns New state and the selected model, or null if only one model
 */
export function cycleModel(state: ModelCycleState): { state: ModelCycleState; model: Model<any> } | null {
	if (state.models.length <= 1) return null;
	
	const nextIndex = (state.currentIndex + 1) % state.models.length;
	const nextModel = state.models[nextIndex];
	if (!nextModel) return null;
	
	// Reset thinking level based on new model's capabilities
	const thinkingLevel = nextModel.reasoning ? state.thinkingLevel : "off";
	
	return {
		state: { ...state, currentIndex: nextIndex, thinkingLevel },
		model: nextModel,
	};
}

/**
 * Cycle thinking level for current model
 * @returns New thinking level, or null if model doesn't support reasoning
 */
export function cycleThinkingLevel(state: ModelCycleState): { state: ModelCycleState; level: ThinkingLevel } | null {
	const currentModel = state.models[state.currentIndex];
	if (!currentModel?.reasoning) return null;
	
	const currentIdx = THINKING_LEVELS.indexOf(state.thinkingLevel);
	const nextIdx = (currentIdx + 1) % THINKING_LEVELS.length;
	const nextLevel = THINKING_LEVELS[nextIdx] ?? "medium";
	
	return {
		state: { ...state, thinkingLevel: nextLevel },
		level: nextLevel,
	};
}

/**
 * Get current model from state
 */
export function getCurrentModel(state: ModelCycleState): Model<any> | null {
	return state.models[state.currentIndex] ?? null;
}

/**
 * Get reasoning effort for API calls (undefined if "off")
 */
export function getReasoningEffort(state: ModelCycleState): ReasoningEffort | undefined {
	return state.thinkingLevel === "off" ? undefined : state.thinkingLevel;
}
